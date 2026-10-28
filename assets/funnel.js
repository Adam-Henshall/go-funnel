// Meta + Google Analytics tracking for the go.omada.ai funnel.
// The base snippets (Meta PageView, GA4 page_view) are inline in each page's <head>; this file adds the funnel events:
//   Meta              GA4                    When
//   -                 vsl_sound_on           landing page, viewer clicks to watch with sound
//   ViewContent       vsl_50_percent         landing page, viewer has watched half the VSL with sound on
//   SubmitApplication application_submitted  landing page, HubSpot form submitted (qualified or not)
//   Lead              generate_lead          /book/ page load, i.e. a qualified applicant. This is the event to optimise for.
//   Schedule          book_meeting           /book/, HubSpot calendar confirms a booking (then we move to /thanks/)
//   -                 application_unqualified /received/ page load (HubSpot didn't qualify them)
//   -                 call_time_selected     /received/, they picked Morning / Afternoon / Evening (emailed via Formspree)
(function () {
  var page = document.body.getAttribute('data-page');

  function eventId(name) {
    return name + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 10);
  }

  // Sends one funnel step to Meta (standard event name) and GA4 (event name); either can be null.
  function track(metaName, gaName, params) {
    if (metaName && typeof window.fbq === 'function') {
      window.fbq('track', metaName, params || {}, { eventID: eventId(metaName) });
    }
    if (gaName && typeof window.gtag === 'function') {
      window.gtag('event', gaName, params || {});
    }
  }

  // True the first time a key is seen this browser session, so reloads don't double count.
  function once(key) {
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
    } catch (e) {}
    return true;
  }

  function setupVideo() {
    var video = document.querySelector('[data-vsl]');
    if (!video) return;
    var soundButton = document.querySelector('[data-enable-sound]');
    var poster = document.querySelector('[data-vsl-poster]');
    var src = video.getAttribute('data-src');
    var started = false;

    function start() {
      if (started) return;
      started = true;
      // Prefer hls.js: recent Chrome reports native HLS support but fails on Mux's separate audio track.
      // Native playback is the fallback for browsers without MSE (older iPhones).
      if (window.Hls && window.Hls.isSupported()) {
        var hls = new window.Hls({ capLevelToPlayerSize: true });
        hls.loadSource(src);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
      }

      // Starts muted (browsers only allow muted autoplay); the button restarts it with sound.
      video.muted = true;
      var autoplay = video.play();
      if (autoplay && autoplay.catch) autoplay.catch(function () {});
    }

    // The poster stays on top until the video has frames to show.
    video.addEventListener('playing', function () {
      if (poster) poster.hidden = true;
    });

    // Video segments would compete with the poster for bandwidth on slow phones, so stream once it has shown.
    if (!poster || poster.complete) {
      start();
    } else {
      poster.addEventListener('load', start);
      poster.addEventListener('error', start);
    }

    if (soundButton) {
      soundButton.addEventListener('click', function () {
        start();
        video.muted = false;
        video.currentTime = 0;
        video.controls = true;
        video.play();
        soundButton.hidden = true;
        if (once('omada_vsl_sound')) track(null, 'vsl_sound_on', { content_name: 'VSL' });
      });
    }

    video.addEventListener('timeupdate', function () {
      if (video.muted || !video.duration) return;
      if (video.currentTime / video.duration >= 0.5 && once('omada_vsl_50')) {
        track('ViewContent', 'vsl_50_percent', { content_name: 'VSL', content_category: 'vsl_50_percent' });
      }
    });
  }

  function setupReadMore() {
    var buttons = document.querySelectorAll('[data-read-more]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (e) {
        var card = e.currentTarget.closest('.card');
        var open = card.classList.toggle('open');
        e.currentTarget.textContent = open ? 'Read less' : 'Read more';
      });
    }
  }

  // HubSpot's embed tells this page where to go after a submission over a MessageChannel, then this page
  // navigates. We rewrite HubSpot's destinations to our own pages before its handler sees them:
  //   omada.ai/bookvsl                  -> /book/      (old qualified redirect; HubSpot now sends /book itself)
  //   grow.omada.ai/application-received -> /received/ (unqualified; until the redirect is changed in HubSpot)
  // This leans on HubSpot internals: if they change, nothing matches and people land on HubSpot's pages as
  // before, which `hubspot_redirect_unhandled` in GA4 flags.
  var HUBSPOT_NAVIGATE = 'HS_CTA_NAVIGATE_PAGE';
  var OLD_BOOKING = /^https:\/\/(www\.)?omada\.ai\/bookvsl\/?(\?|#|$)/;
  var NEW_BOOKING = 'https://go.omada.ai/book/';
  var OLD_RECEIVED = /^https:\/\/grow\.omada\.ai\/application-received\/?(\?|#|$)/;
  var NEW_RECEIVED = 'https://go.omada.ai/received/';
  var APPLICANT_KEY = 'omada_applicant';
  var redirectSeen = false;

  // Keeps the applicant's contact details in this tab only, so the next pages can greet them by name, pre-fill
  // the calendar and say who picked a call time.
  // Never put in a URL or sent to Meta/GA. Gives up after 1.5s so a slow form never blocks the redirect.
  function saveApplicant() {
    var form = window.HubSpotFormsV4 && window.HubSpotFormsV4.getForms && window.HubSpotFormsV4.getForms()[0];
    if (!form) return Promise.resolve();
    var read = Promise.resolve(form.getFormFieldValues()).then(function (fields) {
      var get = function (name) {
        var f = fields.find(function (x) { return x.name === '0-1/' + name; });
        return f ? String(f.value) : '';
      };
      try {
        sessionStorage.setItem(APPLICANT_KEY, JSON.stringify({
          firstName: get('firstname').trim(),
          lastName: get('lastname').trim(),
          name: (get('firstname') + ' ' + get('lastname')).trim(),
          email: get('email'),
          phone: get('mobilephone'),
          business: get('business_type')
        }));
      } catch (e) {}
    }).catch(function () {});
    return Promise.race([read, new Promise(function (resolve) { setTimeout(resolve, 1500); })]);
  }

  function rewriteHubSpotRedirect() {
    var desc = window.MessagePort && Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
    if (!desc || !desc.get || !desc.set) return;
    Object.defineProperty(MessagePort.prototype, 'onmessage', {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (handler) {
        if (typeof handler !== 'function') return desc.set.call(this, handler);
        desc.set.call(this, function (e) {
          var data = e && e.data;
          if (!data || data.type !== HUBSPOT_NAVIGATE || !data.payload || typeof data.payload.url !== 'string') {
            return handler.call(this, e);
          }
          redirectSeen = true;
          var port = this;
          var url = data.payload.url;
          var toBooking = OLD_BOOKING.test(url), toReceived = OLD_RECEIVED.test(url);
          if (toBooking) url = NEW_BOOKING + new URL(url).search; // keeps HubSpot's ?submissionGuid=
          if (toReceived) url = NEW_RECEIVED + new URL(url).search;
          var dest = new URL(url);
          track(null, 'hubspot_redirect', { destination: dest.host + dest.pathname, rewritten: toBooking || toReceived });
          var go = function () {
            handler.call(port, { data: { type: data.type, payload: Object.assign({}, data.payload, { url: url }) } });
          };
          if (dest.host === 'go.omada.ai' && /^\/(book|received)/.test(dest.pathname)) saveApplicant().then(go);
          else go();
        });
      }
    });
  }

  if (page === 'landing') {
    // Must run before HubSpot's deferred embed script opens its channel.
    rewriteHubSpotRedirect();
    var submitted = false;
    window.addEventListener('pagehide', function () {
      if (submitted && !redirectSeen) track(null, 'hubspot_redirect_unhandled', {});
    });
    setupVideo();
    setupReadMore();
    // Fired by HubSpot's embedded form (new editor) before it redirects to the page set in HubSpot.
    window.addEventListener('hs-form-event:on-submission:success', function () {
      submitted = true;
      if (once('omada_application')) track('SubmitApplication', 'application_submitted', { content_name: 'VSL application' });
    });
  }

  // The HubSpot Meetings iframe posts { meetingBookSucceeded: true } to this page once a slot is booked.
  // The short pause lets HubSpot's confirmation show and the tracking requests leave before we move on.
  function setupBooking() {
    window.addEventListener('message', function (e) {
      if (e.origin !== 'https://meetings.hubspot.com' || !e.data || e.data.meetingBookSucceeded !== true) return;
      if (once('omada_booked')) track('Schedule', 'book_meeting', { content_name: 'VSL booking' });
      setTimeout(function () { window.location.href = '../thanks/'; }, 1500);
    });
  }

  function readApplicant() {
    try { return JSON.parse(sessionStorage.getItem(APPLICANT_KEY) || '{}'); } catch (e) { return {}; }
  }

  // The first name as typed in the form, capitalised ("adam" -> "Adam"), or '' when it doesn't look like a name.
  function firstNameOf(applicant) {
    var first = (applicant.firstName || '').trim();
    if (!/^[\p{L}][\p{L}'’ .-]{0,29}$/u.test(first)) return '';
    return first.charAt(0).toUpperCase() + first.slice(1);
  }

  // Swaps the page's default headline for a personal one; set as text, never HTML.
  function greet(text) {
    var heading = document.querySelector('[data-greeting]');
    if (heading) heading.textContent = text;
  }

  // Passes the applicant's name and email to the HubSpot calendar so its booking form is filled in. Must run
  // before HubSpot's MeetingsEmbedCode.js reads data-src, which is why funnel.js loads first on /book/.
  function prefillCalendar(applicant) {
    var container = document.querySelector('.meetings-iframe-container');
    if (!container || !applicant.email) return;
    var url = new URL(container.getAttribute('data-src'));
    if (applicant.firstName) url.searchParams.set('firstName', applicant.firstName);
    if (applicant.lastName) url.searchParams.set('lastName', applicant.lastName);
    url.searchParams.set('email', applicant.email);
    container.setAttribute('data-src', url.toString());
  }

  // /received/ (unqualified applicants): one tap on Morning / Afternoon / Evening emails the choice to the
  // team via Formspree, with the details saveApplicant() kept on the landing page. Moves to HubSpot later.
  var FORMSPREE = 'https://formspree.io/f/mdeezbzv';

  function setupCallTime() {
    var buttons = document.querySelectorAll('[data-call-time]');
    var status = document.querySelector('[data-call-status]');
    var zone = '';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var zoneLabel = document.querySelector('[data-time-zone]');
    if (zoneLabel && zone) zoneLabel.textContent = zone.replace(/_/g, ' ');

    var applicant = readApplicant();
    var first = firstNameOf(applicant);
    if (first) {
      greet('Thanks, ' + first + '.');
      var appliedLine = document.querySelector('[data-applied-line]');
      if (appliedLine) appliedLine.hidden = false;
    }

    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (e) {
        var chosen = e.currentTarget;
        var time = chosen.getAttribute('data-call-time');
        for (var j = 0; j < buttons.length; j++) {
          buttons[j].disabled = true;
          buttons[j].classList.toggle('selected', buttons[j] === chosen);
        }
        status.textContent = 'Saving…';
        fetch(FORMSPREE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            _subject: 'Call time: ' + (applicant.name || 'an applicant') + ' prefers ' + time.toLowerCase(),
            preferred_time: time,
            time_zone: zone || 'unknown',
            name: applicant.name || 'not captured',
            email: applicant.email || 'not captured',
            phone: applicant.phone || 'not captured',
            business_type: applicant.business || 'not captured'
          })
        }).then(function (res) {
          if (!res.ok) throw new Error('Formspree ' + res.status);
          status.textContent = 'Got it. We’ll aim to call you in the ' + time.toLowerCase() + '.';
          track(null, 'call_time_selected', { preferred_time: time });
          try { sessionStorage.removeItem(APPLICANT_KEY); } catch (err) {}
        }).catch(function () {
          status.textContent = 'We couldn’t save that, but don’t worry: we’ll still call you.';
          track(null, 'call_time_failed', { preferred_time: time });
        });
      });
    }
  }

  if (page === 'received') {
    setupCallTime();
    if (once('omada_received')) track(null, 'application_unqualified', { content_name: 'VSL application' });
  }

  if (page === 'book') {
    var booker = readApplicant();
    if (firstNameOf(booker)) greet('You’re in, ' + firstNameOf(booker) + '.');
    prefillCalendar(booker);
    setupBooking();
    if (once('omada_lead')) track('Lead', 'generate_lead', { content_name: 'VSL booking page', value: 100, currency: 'USD' });
  }

  // Last stop for qualified applicants: greet them, then drop their details from the tab.
  if (page === 'thanks') {
    var booked = readApplicant();
    if (firstNameOf(booked)) greet('You’re booked, ' + firstNameOf(booked) + '.');
    try { sessionStorage.removeItem(APPLICANT_KEY); } catch (e) {}
  }
})();
