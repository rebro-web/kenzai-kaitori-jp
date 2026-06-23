/**
 * /form/* のリクエストをレンタルサーバー (kenzai-kaitori.jp) へ透過プロキシ
 *
 * 仕様書の「透過プロキシ」相当をCloudflare Pages Functionsで実装。
 * GET / POST / その他メソッドすべて転送。
 * リダイレクト時のLocationヘッダはpages.dev側に書き換え（URLが kenzai-kaitori.jp に飛ばないよう）。
 */
export async function onRequest(context) {
  const ORIGIN = 'https://kenzai-kaitori.jp';

  const url = new URL(context.request.url);
  const targetUrl = ORIGIN + url.pathname + url.search;

  // リクエストをそのまま転送（メソッド・ヘッダ・ボディ含む）
  const init = {
    method: context.request.method,
    headers: context.request.headers,
    body: ['GET', 'HEAD'].includes(context.request.method) ? undefined : context.request.body,
    redirect: 'manual', // リダイレクトを自動追従しない（Locationを書き換えるため）
  };

  let response;
  try {
    response = await fetch(targetUrl, init);
  } catch (err) {
    return new Response('Upstream fetch failed: ' + err.message, { status: 502 });
  }

  // リダイレクトの場合、Location ヘッダの kenzai-kaitori.jp を削除（同パスでpages.dev側にとどめる）
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('Location');
    if (location) {
      const newHeaders = new Headers(response.headers);
      const newLocation = location
        .replace('https://kenzai-kaitori.jp', '')
        .replace('http://kenzai-kaitori.jp', '');
      newHeaders.set('Location', newLocation || '/');
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }
  }

  // HTML / テキストの場合、本文中の絶対URLも書き換える
  const contentType = response.headers.get('Content-Type') || '';
  if (contentType.includes('text/html') || contentType.includes('text/css')) {
    let body = await response.text();
    body = body.replace(/https?:\/\/kenzai-kaitori\.jp/g, '');
    const newHeaders = new Headers(response.headers);
    newHeaders.delete('Content-Length');
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  // それ以外（画像等）はそのまま返す
  return response;
}
