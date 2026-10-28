// Meta + Google Analytics tracking for the go.omada.ai funnel.
// The base snippets (Meta PageView, GA4 page_view) are inline in each page's <head>; this file adds the funnel events:
//   Meta              GA4                    When
//   -                 vsl_sound_on           landing page, viewer clicks to watch with sound
//   ViewContent       vsl_50_percent         landing page, viewer has watched half the VSL with sound on
//   SubmitApplication application_submitted  landing page, HubSpot form submitted (qualified or not)
//   Lead              generate_lead          /book/ page load, i.e. a qualified applicant. This is the event to optimise for.
//   Schedule          book_meeting           /book/, HubSpot calendar confirms a booking (then we move to /thanks/)
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

  // TEMPORARY until the form's qualified redirect is changed in HubSpot (see README).
  // HubSpot's embed tells this page where to go after a submission over a MessageChannel, then this page
  // navigates. Rewrite the old booking page to ours before HubSpot's handler sees it. This leans on HubSpot
  // internals: if they change, nothing matches and qualified people land on omada.ai/bookvsl as before,
  // which `hubspot_redirect_unhandled` in GA4 flags.
  var HUBSPOT_NAVIGATE = 'HS_CTA_NAVIGATE_PAGE';
  var OLD_BOOKING = /^https:\/\/(www\.)?omada\.ai\/bookvsl\/?(\?|#|$)/;
  var NEW_BOOKING = 'https://go.omada.ai/book/';
  var redirectSeen = false;

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
          var url = data.payload.url;
          var rewritten = OLD_BOOKING.test(url);
          if (rewritten) url = NEW_BOOKING + new URL(url).search; // keeps HubSpot's ?submissionGuid=
          var dest = new URL(url);
          track(null, 'hubspot_redirect', { destination: dest.host + dest.pathname, rewritten: rewritten });
          return handler.call(this, { data: { type: data.type, payload: Object.assign({}, data.payload, { url: url }) } });
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

  if (page === 'book') {
    setupBooking();
    if (once('omada_lead')) track('Lead', 'generate_lead', { content_name: 'VSL booking page', value: 100, currency: 'USD' });
  }
})();
