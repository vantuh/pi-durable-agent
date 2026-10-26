/** Rebase the self-contained Plannotator UI's root-relative transports into its review namespace. */
export function bridgeScript(prefix: string): string {
    return `<script>(()=>{
const prefix=${JSON.stringify(prefix)};
function rebase(input){try{const u=new URL(String(input),location.href);if(u.origin===location.origin&&!u.pathname.startsWith(prefix+'/'))return prefix+u.pathname+u.search+u.hash;}catch{}return String(input);}
const nativeFetch=window.fetch.bind(window);
window.fetch=(input,init)=>nativeFetch(input instanceof Request?new Request(rebase(input.url),input):rebase(input),init);
const ES=window.EventSource;
window.EventSource=class extends ES{constructor(url,options){super(rebase(url),options)}};
const open=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(method,url,...rest){return open.call(this,method,rebase(url),...rest)};
const beacon=navigator.sendBeacon.bind(navigator);
navigator.sendBeacon=(url,data)=>beacon(rebase(url),data);
const WS=window.WebSocket;
window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url),location.href);if(u.host===location.host&&!u.pathname.startsWith(prefix+'/'))u.pathname=prefix+u.pathname;super(u.href,protocols)}};
for(const [type,prop] of [[HTMLImageElement,'src'],[HTMLScriptElement,'src'],[HTMLLinkElement,'href'],[HTMLAnchorElement,'href'],[HTMLIFrameElement,'src'],[HTMLSourceElement,'src'],[HTMLMediaElement,'src']]){
const descriptor=Object.getOwnPropertyDescriptor(type.prototype,prop);
if(descriptor?.set)Object.defineProperty(type.prototype,prop,{...descriptor,set(value){descriptor.set.call(this,rebase(value))}});
}
const attribute=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(name,value){return attribute.call(this,name,['src','href','action','poster'].includes(name.toLowerCase())?rebase(value):value)};
})();</script>`;
}

export function embedHtml(html: string, prefix: string): string {
    if (!/<head(?:\s[^>]*)?>/i.test(html)) {
        throw new Error("Plannotator returned an unsupported HTML document.");
    }
    return html
        .replace(/<head(?:\s[^>]*)?>/i, (head) => head + bridgeScript(prefix))
        .replace('href="/favicon.png"', `href="${prefix}/favicon.png"`);
}
