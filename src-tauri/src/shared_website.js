(() => {
    if(window!==window.top)return;
    function reportPlayback(){
        const media=[...document.querySelectorAll('video,audio')];
        const paused=media.length>0&&media.every(element=>element.paused||element.ended);
        window.__TAURI_INTERNALS__?.invoke('website_source_activity',{paused}).catch(error=>console.warn('Website activity:',error));
    }
    for(const type of ['play','pause','ended','seeked','loadeddata'])document.addEventListener(type,reportPlayback,true);
    // Refresh paused pages after controls, scrolling, and other user changes.
    for(const type of ['click','wheel','keydown'])document.addEventListener(type,()=>setTimeout(reportPlayback,0),true);
    let expanded=null;
    let videoCanvas=null,videoOpacity=null,videoElement=null;
    function clearVideoMirror(){videoCanvas?.remove();videoCanvas=null;if(videoElement&&videoOpacity!==null)videoElement.style.opacity=videoOpacity;videoElement=null;videoOpacity=null;}
    function mirrorExpandedVideo(){
        clearVideoMirror();
        const video=expanded?.querySelector('video');if(!video)return;
        videoElement=video;videoOpacity=video.style.opacity;
        const canvas=document.createElement('canvas');videoCanvas=canvas;
        canvas.dataset.fsVideoMirror='';canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;background:black';
        expanded.append(canvas);const context=canvas.getContext('2d');
        let last=0;
        const schedule=()=>typeof video.requestVideoFrameCallback==='function'?video.requestVideoFrameCallback(draw):requestAnimationFrame(draw);
        function draw(time){
            if(videoCanvas!==canvas||!expanded)return;
            if((typeof video.requestVideoFrameCallback==='function'||time-last>=33)&&video.readyState>=2&&video.videoWidth&&video.videoHeight){
                last=time;const width=Math.round(expanded.clientWidth),height=Math.round(expanded.clientHeight);
                if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
                const scale=Math.min(width/video.videoWidth,height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
                try{context.fillStyle='black';context.fillRect(0,0,width,height);context.drawImage(video,(width-w)/2,(height-h)/2,w,h);video.style.opacity='0';}catch(error){console.error('Website video mirror:',error);clearVideoMirror();return;}
            }
            schedule();
        }
        // Paint the current decoded frame even when the player is paused.
        requestAnimationFrame(draw);
    }
    function expand(element){expanded?.removeAttribute('data-fs-expanded');expanded=element;element?.setAttribute('data-fs-expanded','');document.dispatchEvent(new Event('fullscreenchange'));window.dispatchEvent(new Event('resize'));window.__TAURI_INTERNALS__?.invoke('website_source_fullscreen',{expanded:!!element}).catch(error=>console.error('Website fullscreen:',error));}
    Element.prototype.requestFullscreen=function(){expand(this);window.__freeshowInput?.({type:'play'});mirrorExpandedVideo();return Promise.resolve()};
    document.exitFullscreen=()=>{clearVideoMirror();expand(null);return Promise.resolve()};
    try{Object.defineProperty(document,'fullscreenElement',{get:()=>expanded})}catch{}
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&expanded){event.preventDefault();event.stopImmediatePropagation();clearVideoMirror();expand(null)}},true);
    document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='[data-fs-expanded]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;background:black!important}[data-fs-expanded] video{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;transform:none!important;object-fit:contain!important}';document.head.append(style)});
    let playbackAttempt=0;
    // The expanded canvas mirrors pixels; handle clicks on its video surface
    // explicitly while leaving the site's buttons and seek bar alone.
    document.addEventListener('click',event=>{
        if(!expanded)return;
        const target=event.target;
        if(!(target instanceof Element)||target.closest('button,a,input,.ytp-chrome-bottom,.ytp-chrome-top,.ytp-popup'))return;
        const video=expanded instanceof HTMLVideoElement?expanded:expanded.querySelector('video');
        if(!video||!(target===expanded||target===video||target===videoCanvas||target.closest('.html5-video-container')))return;
        event.preventDefault();event.stopImmediatePropagation();
        if(video.paused)video.play().catch(error=>console.warn('Website playback:',error));else video.pause();
    },true);
    window.__freeshowInput=data=>{
        if(data.type==='pause'){++playbackAttempt;for(const element of document.querySelectorAll('video,audio'))element.pause();return;}
        if(data.type==='play'){
            const attempt=++playbackAttempt,deadline=Date.now()+10000;
            function play(){
                if(attempt!==playbackAttempt)return;
                const media=[...document.querySelectorAll('video,audio')];
                if(media.length){for(const element of media)element.play().catch(error=>console.warn('Website playback:',error));return;}
                if(Date.now()<deadline)setTimeout(play,250);
            }
            play();return;
        }
        if(data.type==='reload'){location.reload();return}
        if(data.type==='back'){history.back();return}
        if(data.type==='forward'){history.forward();return}
        if(data.type==='wheel'){scrollBy(Number(data.x)||0,Number(data.y)||0);return}
        if(data.type==='click'){
            const x=Math.max(0,Math.min(1,Number(data.x)||0))*innerWidth,y=Math.max(0,Math.min(1,Number(data.y)||0))*innerHeight;
            const target=document.elementFromPoint(x,y);target?.focus?.();
            if(target)for(const type of ['mousedown','mouseup','click'])target.dispatchEvent(new MouseEvent(type,{view:window,clientX:x,clientY:y,bubbles:true,cancelable:true}));return;
        }
        if(data.type==='key'){
            if(data.key==='Escape'&&expanded){clearVideoMirror();expand(null);return}
            const target=document.activeElement||document.body;
            if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement){
                if(data.key==='Backspace')target.value=target.value.slice(0,-1);else if(data.key.length===1)target.value+=data.key;
                target.dispatchEvent(new Event('input',{bubbles:true}));
            }
            for(const type of ['keydown','keyup'])target.dispatchEvent(new KeyboardEvent(type,{key:data.key,code:data.key===' '?'Space':data.key,bubbles:true,cancelable:true}));
        }
    };
})();
