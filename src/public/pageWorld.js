(function(){
  console.log('[SPL] inj: start')
  
  let cachedPot = null;

  // 1. Capture POT token from network requests
  const extractPot = (url) => {
    if(url && url.includes('timedtext') && url.includes('pot=')){
      const m = url.match(/[?&]pot=([^&]+)/);
      if(m && m[1]){
        cachedPot = m[1];
        console.log('[SPL] inj: captured POT token', cachedPot.substring(0, 10)+'...');
      }
    }
  }

  // 2. Force POT token if missing (Competitor logic: click CC button twice)
  const ensurePot = async () => {
    if(cachedPot) return cachedPot;
    console.log('[SPL] inj: no POT token, forcing captions...');
    const btn = document.querySelector('.ytp-subtitles-button');
    if(btn){
      btn.click();
      await new Promise(r => setTimeout(r, 200));
      btn.click();
      // Wait for POT
      for(let i=0; i<20; i++){
        if(cachedPot) return cachedPot;
        await new Promise(r => setTimeout(r, 100));
      }
    } else {
        console.log('[SPL] inj: no subtitles button found');
    }
    return cachedPot;
  }

  const postSegments = (segs, lang) => {
    console.log('[SPL] inj: posting segments', { count: segs.length, lang })
    if (segs && segs.length > 0) {
      window.postMessage({ type: 'SPL_CAPTIONS_FOUND', payload: { segments: segs, language: lang } }, '*')
      return true
    }
    return false
  }
  
  // Build fine-grained segments from YouTube JSON3 caption events
  // Each word (or small chunk) becomes one segment with its own timing
  const buildSegmentsFromEvents = (events) => {
    const segments = []
    if (!Array.isArray(events)) return segments

    const LAST_WORD_FALLBACK_MS = 2000

    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      if (!ev || !Array.isArray(ev.segs) || ev.segs.length === 0) continue

      // Clean up text inside this event and drop empty chunks
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

  const fetchAndParseCaptions = async (u, lang) => {
    await ensurePot();
    const potParam = cachedPot ? `&pot=${cachedPot}` : '';

    // Try JSON3 (Standard) with POT token
    try { 
      const u1 = u + '&fmt=json3' + potParam; 
      console.log('[SPL] inj: fetch json3', u1); 
      const r1 = await fetch(u1, { credentials: 'include' }); 
      if(r1.ok){ 
        const d = await r1.json(); 
        if(d && Array.isArray(d.events)){ 
          const segs = buildSegmentsFromEvents(d.events)
            .filter(s=>s.text && s.text.trim().length>0); 
          
          console.log('[SPL] inj: json3 segments', segs.length); 
          if(postSegments(segs, lang)) return true 
        } 
      } else {
        console.log('[SPL] inj: json3 fetch failed', r1.status);
      }
    } catch (e) { console.log('[SPL] inj: json3 error', e) }

    console.log('[SPL] inj: captions failed'); return false
  }

  const pickTrack = (tracks) => { 
    let t = tracks.find(x=>x.languageCode==='en'); 
    if(!t) t = tracks.find(x=>x.languageCode && x.languageCode.startsWith('en')); 
    if(!t) t = tracks.find(x=>x.kind==='asr'); 
    if(!t) t = tracks[0]; 
    console.log('[SPL] inj: pick track', t?{ languageCode: t.languageCode, kind: t.kind }:null); 
    return t 
  }

  const processPlayerResponse = (pr) => { 
    if(!pr||!pr.captions||!pr.captions.playerCaptionsTracklistRenderer) return false; 
    const tracks = pr.captions.playerCaptionsTracklistRenderer.captionTracks; 
    if(!tracks||tracks.length===0) return false; 
    console.log('[SPL] inj: tracks found', tracks.length); 
    
    const t = pickTrack(tracks); 
    if(t&&t.baseUrl){ 
      fetchAndParseCaptions(t.baseUrl, t.languageCode||''); 
      return true 
    } 
    return false 
  }

  const checkGlobal = () => { 
    if(window.ytInitialPlayerResponse){ 
      console.log('[SPL] inj: check global'); 
      processPlayerResponse(window.ytInitialPlayerResponse) 
    } 
  }

  // Intercept Fetch
  const of = window.fetch; 
  window.fetch = async function(...args){ 
    const url = args[0]?args[0].toString():''; 
    extractPot(url);
    const resp = await of.apply(this, args); 
    if(url.includes('/youtubei/v1/player')){ 
      console.log('[SPL] inj: intercepted fetch', url); 
      resp.clone().json().then(d=>{ processPlayerResponse(d) }).catch(()=>{}) 
    } 
    return resp 
  }

  // Intercept XHR
  const ox = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url){
    const u = url?url.toString():'';
    extractPot(u);
    this.addEventListener('load', function(){
      if(u.includes('/youtubei/v1/player')){
        console.log('[SPL] inj: intercepted xhr', u);
        try{ const d = JSON.parse(this.responseText); processPlayerResponse(d) }catch{} 
      }
    });
    return ox.apply(this, arguments);
  }

  // Start
  setTimeout(checkGlobal, 1000);
})();
