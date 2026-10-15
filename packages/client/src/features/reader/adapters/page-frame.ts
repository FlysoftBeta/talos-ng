import { AppError } from "@talos/base";

const nonce = "talos-reader-runtime";
const policy = `default-src 'none'; img-src blob: data:; style-src blob: 'unsafe-inline'; script-src blob: 'nonce-${nonce}'; font-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
/** Only the converter's content-addressed resources can enter an opaque frame. */
export function sanitizePage(
  html: string,
  resources: ReadonlyMap<string, { mime: string }>,
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll(
      "base,iframe,frame,object,embed,form,input,button,textarea,select,meta,script:not([data-bundle-ref])",
    )
    .forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      if (
        /^on/i.test(attr.name) ||
        ["srcdoc", "nonce", "srcset"].includes(attr.name.toLowerCase())
      )
        node.removeAttribute(attr.name);
    }
    const ref = node.getAttribute("data-bundle-ref");
    if (ref) {
      const resource = resources.get(ref);
      if (!resource) throw new AppError("E_INTEGRITY", "页面依赖缺失");
      if (
        node.tagName === "SCRIPT" &&
        !/^(text|application)\/javascript$/.test(resource.mime)
      )
        throw new AppError("E_INTEGRITY", "页面脚本类型错误");
      if (node.tagName === "LINK" && resource.mime !== "text/css")
        throw new AppError("E_INTEGRITY", "页面样式类型错误");
    }
    for (const name of ["href", "src", "xlink:href", "poster"]) {
      if (!node.hasAttribute(name)) continue;
      if (ref) node.setAttribute(name, "#");
      else node.removeAttribute(name);
    }
  });
  const csp = doc.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = policy;
  doc.head.insertBefore(csp, doc.head.firstChild);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}

const navigation = `(function(){function scroll(y){parent.postMessage({type:'talos-scroll',y:y},'*')}addEventListener('wheel',function(e){e.preventDefault();scroll(e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?innerHeight:1))},{passive:false});var touch=null;addEventListener('touchstart',function(e){touch=e.touches.length===1?e.touches[0].clientY:null},{passive:true});addEventListener('touchmove',function(e){if(touch===null||e.touches.length!==1)return;var y=e.touches[0].clientY;e.preventDefault();scroll(touch-y);touch=y},{passive:false});addEventListener('touchend',function(){touch=null});addEventListener('keydown',function(e){var y=e.key==='ArrowDown'?40:e.key==='ArrowUp'?-40:e.key==='PageDown'||e.key===' '||e.key==='Spacebar'?innerHeight*.85:e.key==='PageUp'?-innerHeight*.85:0;if(y){e.preventDefault();scroll(e.shiftKey?-y:y)}});addEventListener('unload',function(){(window.pageUrls||[]).forEach(function(url){URL.revokeObjectURL(url)})});parent.postMessage({type:'talos-page-ready'},'*')})()`;
/** Blob URLs must be created inside the opaque iframe, including on Chromium 70. */
export const FRAME_DOCUMENT = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body><script nonce="${nonce}">(function(){addEventListener('message',function(e){if(e.source!==parent||!e.data||e.data.type!=='talos-page')return;try{var urls=[],refs=Object.create(null);e.data.resources.forEach(function(r){refs[r.rid]=URL.createObjectURL(new Blob([r.bytes],{type:r.mime}));urls.push(refs[r.rid])});var doc=new DOMParser().parseFromString(e.data.html,'text/html');doc.querySelectorAll('[data-bundle-ref]').forEach(function(n){var url=refs[n.getAttribute('data-bundle-ref')];if(!url)throw Error('页面资源缺失');['href','src','xlink:href'].forEach(function(a){if(n.hasAttribute(a))n.setAttribute(a,url)});n.removeAttribute('data-bundle-ref')});var script=doc.createElement('script');script.setAttribute('nonce','${nonce}');script.textContent=${JSON.stringify(navigation)};doc.head.appendChild(script);window.pageUrls=urls;document.open();document.write('<!doctype html>'+doc.documentElement.outerHTML);document.close()}catch(error){parent.postMessage({type:'talos-page-error',message:String(error)},'*')}},{once:true});parent.postMessage({type:'talos-frame-ready'},'*')})()</script></body></html>`;
