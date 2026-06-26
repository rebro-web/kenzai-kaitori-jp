/**
 * 匿名査定フォーム受信エンドポイント
 *
 * URL: POST /api/contact
 *
 * 機能:
 *   1) 入力チェック・サニタイズ
 *   2) スパム対策（ハニーポット / リファラ / POST限定）
 *   3) Resend APIで管理者通知メール送信
 *   4) Resend APIで自動返信メール送信
 *   5) GAS WebAppでスプレッドシート記録
 *   6) 完了ページへリダイレクト
 *
 * 必要な環境変数（Cloudflare Pagesダッシュボードで設定）:
 *   - RESEND_API_KEY    : Resend APIキー
 *   - GAS_URL           : GAS WebApp の URL
 *   - GAS_TOKEN         : GAS WebApp の共有シークレット
 */

// ============================================
// サイト固有設定
// ============================================
const SITE_NAME    = '建材・住宅設備の買取専門店レコテック';
const SITE_SHORT   = 'レコテック';
const SITE_DOMAIN  = 'kenzai-kaitori.jp';
const FROM_EMAIL   = 'onboarding@resend.dev'; // Resendサンドボックスドメイン（独自ドメイン認証後に info@kenzai-kaitori.jp に変更）
const FROM_NAME    = 'レコテック';
// Resendドメイン認証完了までは rebro.web@gmail.com のみ
// 認証完了後に ['info@kenzai-kaitori.jp', 'rebro.web@gmail.com'] へ戻す
const ADMIN_EMAILS = ['rebro.web@gmail.com'];
const VERIFIED_TESTING_EMAIL = 'rebro.web@gmail.com'; // Resend制約：これ以外には送れない
const THANKS_PAGE  = '/thanks/';
const ERROR_PAGE   = '/form/error/';


// ============================================
// メインハンドラ
// ============================================
export async function onRequest(context) {
  const { request, env } = context;

  // POSTメソッド限定
  if (request.method !== 'POST') {
    return redirect(ERROR_PAGE + '?reason=method');
  }

  // リファラチェック（同一ドメインから来てるか）
  // ※デバッグモード時はスキップ（?debug=1 がURLに付いていれば緩める）
  const url = new URL(request.url);
  const debugMode = url.searchParams.get('debug') === '1';
  if (!debugMode) {
    const referer = request.headers.get('Referer') || '';
    if (!referer.includes(url.host) && !referer.includes(SITE_DOMAIN)) {
      return redirect(ERROR_PAGE + '?reason=referer');
    }
  }

  // フォームデータを取得
  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return redirect(ERROR_PAGE + '?reason=parse');
  }

  // ハニーポット（隠しフィールド website に値が入っていたら拒否）
  if (formData.get('website')) {
    // ボットの可能性 → 何事もなかったかのように完了ページへ
    return redirect(THANKS_PAGE);
  }

  // 入力値の取得・サニタイズ
  const name    = clean(formData.get('text-461') || '');
  const email   = clean(formData.get('email-001') || '');
  const message = clean(formData.get('textarea-001') || '');

  // 商品情報（最大5商品）を整形
  const products = [];
  for (let i = 1; i <= 5; i++) {
    const base = (i - 1) * 5;
    const maker     = clean(formData.get(`text-${pad(base + 1)}`) || '');
    const product   = clean(formData.get(`text-${pad(base + 2)}`) || '');
    const jan       = clean(formData.get(`text-${pad(base + 3)}`) || '');
    const qty       = clean(formData.get(`text-${pad(base + 4)}`) || '');
    const condition = clean(formData.get(`menu-${pad(base + 5)}`) || '');

    if (maker || product || jan || (qty && qty !== '1') || condition) {
      products.push({ maker, product, jan, qty, condition });
    } else if (i === 1 && qty === '1') {
      // 商品1は数量デフォルトが「1」なので、それだけで未入力扱いにしない
      if (maker || product || jan || condition) {
        products.push({ maker, product, jan, qty, condition });
      }
    }
  }

  // 入力チェック（必須項目）
  const errors = [];
  if (!name)  errors.push('お名前が入力されていません');
  if (!email) {
    errors.push('メールアドレスが入力されていません');
  } else if (!isValidEmail(email)) {
    errors.push('メールアドレスの形式が正しくありません');
  }
  if (errors.length > 0) {
    return redirect(ERROR_PAGE + '?reason=' + encodeURIComponent(errors.join('|')));
  }

  // ============================================
  // メール送信（Resend API）
  // ============================================
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return redirect(ERROR_PAGE + '?reason=config');
  }

  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  // Contact Form 7の件名フォーマットを再現
  // 例: 「レコテックへ◯◯様から匿名査定がありました。商品：◯◯」
  const firstProductName = products[0]?.product || '（商品名未入力）';
  const adminSubject = `${SITE_SHORT}へ${name}様から匿名査定がありました。商品：${firstProductName}`;
  const adminBody    = buildAdminBody({ now, name, email, message, products });

  const adminResult = await sendMail(apiKey, {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: ADMIN_EMAILS,
    subject: adminSubject,
    text: adminBody,
    reply_to: `${name} <${email}>`,
  });

  // 自動返信メール（送信者宛）
  const replySubject = `【${SITE_SHORT}】査定依頼を受け付けました`;
  const replyBody    = buildReplyBody({ name, email, message, products });

  // 自動返信は送信者宛だが、Resendサンドボックス制約により
  // 検証済みアドレス以外には送信できない。それ以外は管理者宛にCCする形で代替
  const replyTo = (email === VERIFIED_TESTING_EMAIL) ? email : VERIFIED_TESTING_EMAIL;
  const replyResult = await sendMail(apiKey, {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: [replyTo],
    subject: replySubject + (email === VERIFIED_TESTING_EMAIL ? '' : `（本来宛先: ${email}）`),
    text: replyBody,
  });

  // デバッグモードならResendのレスポンスをそのまま返す
  if (debugMode) {
    return new Response(JSON.stringify({
      ok: true,
      admin_result: adminResult,
      reply_result: replyResult,
      from_email: FROM_EMAIL,
      admin_emails: ADMIN_EMAILS,
      reply_to: email,
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ============================================
  // スプレッドシート記録（GAS WebApp）
  // ============================================
  if (env.GAS_URL && env.GAS_TOKEN) {
    const gasProducts = products.map(p => ({
      maker:     p.maker,
      product:   p.product,
      jan:       p.jan,
      qty:       p.qty,
      condition: p.condition,
    }));

    const payload = {
      token:     env.GAS_TOKEN,
      site_name: SITE_NAME,
      email:     email,
      name:      name,
      tel:       '',
      pref:      '',
      memo:      message,
      products:  gasProducts,
    };

    // 失敗してもメール送信は完了扱いにするため await はするが結果は無視
    try {
      await fetch(env.GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) { /* ignore */ }
  }

  return redirect(THANKS_PAGE);
}


// ============================================
// ヘルパー関数
// ============================================

// 数字を3桁ゼロ埋め（001, 002, …）
function pad(n) {
  return String(n).padStart(3, '0');
}

// 制御文字除去
function clean(v) {
  return String(v).trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// メールアドレス形式チェック
function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// リダイレクトレスポンス
function redirect(location) {
  return new Response(null, {
    status: 303,
    headers: { Location: location },
  });
}

// 商品情報を Contact Form 7 風に整形（【商品1】メーカー：◯◯ 商品名：◯◯ …）
function formatProductsCF7(products) {
  if (products.length === 0) return '（商品情報の入力なし）';
  return products.map((p, i) => {
    return [
      `【商品${i + 1}】`,
      `メーカー：${p.maker || ''}`,
      `商品名：${p.product || ''}`,
      `JAN・型番：${p.jan || ''}`,
      `数量：${p.qty || ''}`,
      `商品状態：${p.condition || ''}`,
    ].join('\n');
  }).join('\n\n');
}

// 管理者宛メール本文（Contact Form 7のテンプレ風）
function buildAdminBody({ now, name, email, message, products }) {
  const productsText = formatProductsCF7(products);
  return `お名前：${name}
メールアドレス：${email}
備考・買取希望価格：${message || ''}

${productsText}

--
受信日時：${now}
このメールはサイトのフォーム経由で送信されました。
返信は送信元（${email}）に送られます。`;
}

// 自動返信メール本文（送信者向け・Contact Form 7のテンプレ風）
function buildReplyBody({ name, email, message, products }) {
  const productsText = formatProductsCF7(products);
  return `${name} 様

この度は ${SITE_NAME} の匿名査定フォームへ
お申し込みいただきまして、誠にありがとうございます。

下記の内容で査定依頼を承りました。
担当者より2営業日以内にご連絡させていただきます。

────────────────────
お名前：${name}
メールアドレス：${email}
備考・買取希望価格：${message || ''}

${productsText}
────────────────────

※このメールは自動送信されています。
※このメールに心当たりがない場合はお手数ですが破棄してください。

────────────────────
${SITE_NAME}
https://${SITE_DOMAIN}/
────────────────────`;
}

// Resend API でメール送信
async function sendMail(apiKey, payload) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, to: payload.to };
  } catch (err) {
    return { error: err.message, to: payload.to };
  }
}
