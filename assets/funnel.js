// Meta tracking for the go.omada.ai funnel.
// The base pixel snippet (PageView) is inline in each page's <head>; this file adds the funnel events:
//   ViewContent       landing page, viewer has watched half the VSL with sound on
//   SubmitApplication landing page, HubSpot form submitted (qualified or not)
//   Lead              /book/ page load, i.e. a qualified applicant. This is the event to optimise for.
(function () {
  var page = document.body.getAttribute('data-page');

  function eventId(name) {
    return name + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 10);
  }

  function track(name, params) {
    if (typeof window.fbq !== 'function') return;
    window.fbq('track', name, params || {}, { eventID: eventId(name) });
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
    var src = video.getAttribute('data-src');

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    } else if (window.Hls && window.Hls.isSupported()) {
      var hls = new window.Hls({ capLevelToPlayerSize: true });
      hls.loadSource(src);
      hls.attachMedia(video);
    }

    // Starts muted (browsers only allow muted autoplay); the button restarts it with sound.
    video.muted = true;
    var autoplay = video.play();
    if (autoplay && autoplay.catch) autoplay.catch(function () {});

    if (soundButton) {
      soundButton.addEventListener('click', function () {
        video.muted = false;
        video.currentTime = 0;
        video.controls = true;
        video.play();
        soundButton.hidden = true;
      });
    }

    video.addEventListener('timeupdate', function () {
      if (video.muted || !video.duration) return;
      if (video.currentTime / video.duration >= 0.5 && once('omada_vsl_50')) {
        track('ViewContent', { content_name: 'VSL', content_category: 'vsl_50_percent' });
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

  if (page === 'landing') {
    setupVideo();
    setupReadMore();
    // Fired by HubSpot's embedded form (new editor) before it redirects to the page set in HubSpot.
    window.addEventListener('hs-form-event:on-submission:success', function () {
      if (once('omada_application')) track('SubmitApplication', { content_name: 'VSL application' });
    });
  }

  if (page === 'book' && once('omada_lead')) {
    track('Lead', { content_name: 'VSL booking page', value: 100, currency: 'USD' });
  }
})();
