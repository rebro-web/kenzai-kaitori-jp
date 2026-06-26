/**
 * Resend ドメイン管理用エンドポイント（管理者用・本番リリース前に削除予定）
 *
 * URL: GET /api/resend-admin?action=list-domains
 *      GET /api/resend-admin?action=add-domain&domain=kenzai-kaitori.jp
 *      GET /api/resend-admin?action=verify-domain&id=DOMAIN_ID
 *      GET /api/resend-admin?action=list-apikeys
 *
 * 認証: ?secret=<TOKEN> （簡易）
 */
const ADMIN_SECRET = 'ZJ5hwbdf9rwASqRaUez7awNPBZ7XNRJq'; // GAS_TOKEN を流用

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.searchParams.get('secret') !== ADMIN_SECRET) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return jsonResponse({ error: 'RESEND_API_KEY not set' }, 500);

  const action = url.searchParams.get('action') || 'list-domains';

  if (action === 'list-domains') {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    return jsonResponse(await res.json(), res.status);
  }

  if (action === 'add-domain') {
    const domain = url.searchParams.get('domain');
    if (!domain) return jsonResponse({ error: 'domain required' }, 400);
    const res = await fetch('https://api.resend.com/domains', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain, region: 'us-east-1' }),
    });
    return jsonResponse(await res.json(), res.status);
  }

  if (action === 'get-domain') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResponse({ error: 'id required' }, 400);
    const res = await fetch(`https://api.resend.com/domains/${id}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    return jsonResponse(await res.json(), res.status);
  }

  if (action === 'verify-domain') {
    const id = url.searchParams.get('id');
    if (!id) return jsonResponse({ error: 'id required' }, 400);
    const res = await fetch(`https://api.resend.com/domains/${id}/verify`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    return jsonResponse(await res.json(), res.status);
  }

  return jsonResponse({ error: 'unknown action' }, 400);
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
