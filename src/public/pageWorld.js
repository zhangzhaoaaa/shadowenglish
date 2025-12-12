(function () {
  console.log('[SPL] inj: start (v2 - competitor inspired)');

  // --- State ---
  let currentVideoId = null;
  const potCache = new Map(); // videoId -> potToken

  // --- Helpers ---
  const getVideoId = () => {
    return new URLSearchParams(window.location.search).get('v');
  };

  const getPlayerResponse = () => {
    const player = document.querySelector('.html5-video-player');
    if (player && typeof player.getPlayerResponse === 'function') {
      return player.getPlayerResponse();
    }
    return null;
  };

  const isVideoPlaying = (video) => {
    return video && video.currentTime > 0 && !video.paused && !video.ended && video.readyState >= 2;
  };

  // --- POT Token Logic ---
  const extractPot = (url) => {
    if (url && url.includes('timedtext') && url.includes('pot=')) {
      const m = url.match(/[?&]pot=([^&]+)/);
      const v = url.match(/[?&]v=([^&]+)/);
      if (m && m[1]) {
        const pot = m[1];
        const vid = v ? v[1] : getVideoId();
        if (vid) {
          console.log('[SPL] inj: captured POT for', vid, pot.substring(0, 5) + '...');
          potCache.set(vid, pot);
        }
      }
    }
  };

  const forceCaptionRequests = async () => {
    const video = document.querySelector('video');
    if (!video || !isVideoPlaying(video)) return;

    let btn = document.querySelector('.ytp-subtitles-button');
    // Wait a bit if button not found immediately
    if (!btn) {
      await new Promise(r => setTimeout(r, 500));
      btn = document.querySelector('.ytp-subtitles-button');
    }

    if (btn) {
      console.log('[SPL] inj: forcing captions via button click');
      btn.click();
      await new Promise(r => setTimeout(r, 200));
      btn.click();
    }
  };

  const ensurePot = async (videoId) => {
    if (potCache.has(videoId)) return potCache.get(videoId);

    console.log('[SPL] inj: POT missing for', videoId, 'waiting...');
    const startTime = Date.now();
    const MAX_WAIT = 10000; // 10s timeout

    while (Date.now() - startTime < MAX_WAIT) {
      if (potCache.has(videoId)) return potCache.get(videoId);

      await forceCaptionRequests();
      await new Promise(r => setTimeout(r, 1000));
    }

    return potCache.get(videoId) || null;
  };

  // --- Segments Logic ---
  const buildSegmentsFromEvents = (events) => {
    const segments = []
    if (!Array.isArray(events)) return segments

    const LAST_WORD_FALLBACK_MS = 2000

    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      if (!ev || !Array.isArray(ev.segs) || ev.segs.length === 0) continue

      const cleanedSegs = ev.segs
        .map((seg) => {
          const raw = (seg && typeof seg.utf8 === 'string') ? seg.utf8 : ''
          const text = raw.replace(/\[.*?\]/g, '').trim()
          return { ...seg, text }
        })
        .filter((seg) => seg.text && seg.text.length > 0)

      if (cleanedSegs.length === 0) continue

      const baseStartMs = typeof ev.tStartMs === 'number' ? ev.tStartMs : 0
      const nextEvent = events[i + 1]
      const nextEventStartMs = (nextEvent && typeof nextEvent.tStartMs === 'number') ? nextEvent.tStartMs : 0
      const boundaryMs = nextEventStartMs > 0 ? nextEventStartMs - 1 : baseStartMs + LAST_WORD_FALLBACK_MS
      const isLastEvent = i === events.length - 1

      for (let j = 0; j < cleanedSegs.length; j++) {
        const current = cleanedSegs[j]
        const nextSeg = cleanedSegs[j + 1]

        const offsetMs = typeof current.tOffsetMs === 'number' ? current.tOffsetMs : 0
        const startMs = baseStartMs + offsetMs

        let endMs
        if (nextSeg && typeof nextSeg.tOffsetMs === 'number') {
          endMs = baseStartMs + nextSeg.tOffsetMs
        } else if (isLastEvent) {
          endMs = startMs + LAST_WORD_FALLBACK_MS
        } else {
          endMs = boundaryMs
        }

        if (!(endMs > startMs)) continue

        segments.push({
          startSeconds: startMs / 1000,
          endSeconds: endMs / 1000,
          durationSeconds: (endMs - startMs) / 1000,
          text: current.text
        })
      }
    }
    return segments
  }

  // --- Main Fetch Logic ---
  const processVideo = async (videoId) => {
    console.log('[SPL] inj: processing video', videoId);

    // 1. Get Player Response (wait if needed)
    let playerResponse = null;
    const startTime = Date.now();
    while (Date.now() - startTime < 10000) {
      const pr = getPlayerResponse();
      if (pr && pr.videoDetails && pr.videoDetails.videoId === videoId) {
        playerResponse = pr;
        break;
      }
      await new Promise(r => setTimeout(r, 200));
    }

    if (!playerResponse) {
      console.log('[SPL] inj: failed to get player response for', videoId);
      return;
    }

    // 2. Check for captions
    if (!playerResponse.captions || !playerResponse.captions.playerCaptionsTracklistRenderer) {
      console.log('[SPL] inj: no captions in player response');
      return;
    }

    const tracks = playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
    if (!tracks || tracks.length === 0) {
      console.log('[SPL] inj: no caption tracks found');
      return;
    }

    // 3. Pick Track
    let track = tracks.find(x => x.languageCode === 'en');
    if (!track) track = tracks.find(x => x.languageCode && x.languageCode.startsWith('en'));
    if (!track) track = tracks.find(x => x.kind === 'asr');
    if (!track) track = tracks[0];

    if (!track || !track.baseUrl) {
      console.log('[SPL] inj: no suitable track found');
      return;
    }

    // 4. Get POT Token
    const pot = await ensurePot(videoId);
    const potParam = pot ? `&pot=${pot}` : '';

    // 5. Fetch Captions
    try {
      const url = `${track.baseUrl}&fmt=json3${potParam}&c=WEB&lang=${track.languageCode}`;
      console.log('[SPL] inj: fetching captions', url);
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
      
      const data = await resp.json();
      if (data && Array.isArray(data.events)) {
        const segments = buildSegmentsFromEvents(data.events);
        console.log('[SPL] inj: segments built', segments.length);
        
        window.postMessage({
          type: 'SPL_CAPTIONS_FOUND',
          payload: {
            segments: segments,
            language: track.languageCode,
            videoId: videoId
          }
        }, '*');
      }
    } catch (e) {
      console.error('[SPL] inj: caption fetch error', e);
    }
  };

  // --- Interceptors ---
  const setupInterceptors = () => {
    // Fetch
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const url = args[0] ? args[0].toString() : '';
      extractPot(url);
      return originalFetch.apply(this, args);
    };

    // XHR
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      const u = url ? url.toString() : '';
      extractPot(u);
      return originalOpen.apply(this, arguments);
    };
  };

  // --- Watcher ---
  const startWatcher = () => {
    let lastHref = location.href;
    
    const check = () => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        const newId = getVideoId();
        if (newId && newId !== currentVideoId) {
          currentVideoId = newId;
          processVideo(newId);
        }
      }
      requestAnimationFrame(check);
    };
    
    requestAnimationFrame(check);

    // Initial check
    const initialId = getVideoId();
    if (initialId) {
      currentVideoId = initialId;
      processVideo(initialId);
    }
  };

  // --- Init ---
  setupInterceptors();
  startWatcher();

  // Listen for manual requests from sidepanel
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'SPL_REQUEST_CAPTIONS') {
      const vid = getVideoId();
      if (vid) processVideo(vid);
    }
  });

})();
