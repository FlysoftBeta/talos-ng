import { click } from "../../harness/ui.mjs";

export async function fill(cdp, label, value) {
  await cdp.evaluate(
    `(function(){var label=Array.prototype.slice.call(document.querySelectorAll('label')).find(function(e){return e.textContent.indexOf(${JSON.stringify(label)})>=0;});var input=label&&document.getElementById(label.htmlFor);if(!input)throw new Error('Missing field '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
}
export async function logout(cdp) {
  await click(cdp, "设置");
  await click(cdp, "退出登录");
  await click(cdp, "确认退出登录");
  await cdp.wait(
    '!!document.querySelector(\'[data-testid="auth.login"], [data-testid="auth.concealed"]\')',
  );
}
