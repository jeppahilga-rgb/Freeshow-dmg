(() => {
    if (window !== window.top || window.__freeshowFollow) return;
    let applying = false, expanded = null, pendingUrl = null;
    const path = element => {
        if (!(element instanceof Element)) return null;
        if (element.id) return '#' + CSS.escape(element.id);
        const parts = [];
        while (element && element !== document.documentElement && parts.length < 18) {
            const parent = element.parentElement;
            if (!parent) break;
            parts.unshift(element.tagName.toLowerCase() + ':nth-child(' + (Array.prototype.indexOf.call(parent.children, element) + 1) + ')');
            element = parent;
        }
        return 'html > ' + parts.join(' > ');
    };
    const find = selector => { try { return selector ? document.querySelector(selector) : null; } catch { return null; } };
    const player = () => [...document.querySelectorAll('video,audio')].sort((a,b) => b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
    function expand(selector) {
        if (expanded) { const old = find(expanded); old?.removeAttribute('data-freeshow-expanded'); }
        expanded = selector;
        const element = find(selector);
        element?.setAttribute('data-freeshow-expanded','');
        document.dispatchEvent(new Event('fullscreenchange'));
        window.dispatchEvent(new Event('resize'));
    }
    Element.prototype.requestFullscreen = function () { expand(path(this)); report(true); return Promise.resolve(); };
    document.exitFullscreen = () => { expand(null); report(true); return Promise.resolve(); };
    try { Object.defineProperty(document,'fullscreenElement',{get:()=>find(expanded)}); } catch {}
    document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '[data-freeshow-expanded]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;background:black!important} [data-freeshow-expanded] video{width:100%!important;height:100%!important;object-fit:contain!important}';
        document.head.appendChild(style);
    });
    function report(interaction = false, click = null) {
        if (applying) return;
        const media = player();
        const data = { interaction, click, url:location.href, scrollX, scrollY, expanded,
            theater:document.querySelector('ytd-watch-flexy')?.hasAttribute('theater') ?? null,
            media: media ? {time:media.currentTime,paused:media.paused,rate:media.playbackRate} : null };
        window.__TAURI_INTERNALS__?.invoke('website_follow',{data}).catch(()=>{});
    }
    window.__freeshowFollow = data => {
        applying = true;
        try {
            if (location.href !== data.url) { if (pendingUrl !== data.url) { pendingUrl=data.url; location.replace(data.url); } return; }
            if (data.click) find(data.click)?.click();
            const watch = document.querySelector('ytd-watch-flexy');
            if (watch && typeof data.theater === 'boolean' && watch.hasAttribute('theater') !== data.theater) document.querySelector('.ytp-size-button')?.click();
            if (expanded !== data.expanded) expand(data.expanded);
            if (Math.abs(scrollX-data.scrollX)>1 || Math.abs(scrollY-data.scrollY)>1) scrollTo(data.scrollX,data.scrollY);
            const media = player();
            if (media && data.media && media.readyState >= 1) {
                if (Math.abs(media.currentTime-data.media.time)>0.5) media.currentTime=data.media.time;
                media.playbackRate=data.media.rate;
                if (data.media.paused) { if (!media.paused) media.pause(); }
                else if (media.paused) media.play().catch(()=>{});
            }
        } finally { applying = false; }
    };
    document.addEventListener('click',event => {
        if (!event.isTrusted) return;
        const element = event.target.closest?.('button,a,[role="button"],summary');
        // Media state handles player buttons without toggling independent players twice.
        const selector = element && !element.closest('.html5-video-player') ? path(element) : null;
        setTimeout(()=>report(true,selector),80);
    },true);
    document.addEventListener('wheel',()=>report(true),{passive:true});
    document.addEventListener('pointerdown',()=>report(true),true);
    document.addEventListener('scroll',()=>report(),{passive:true});
    document.addEventListener('keydown',event => { if(event.key==='Escape' && expanded) { event.stopImmediatePropagation(); document.exitFullscreen(); } },true);
    setInterval(()=>report(),300);
})();
