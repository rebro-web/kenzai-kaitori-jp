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
const SITE_DOMAIN  = 'kenzai-kaitori.jp';
const FROM_EMAIL   = 'onboarding@resend.dev'; // Resendサンドボックスドメイン（独自ドメイン認証後に変更）
const FROM_NAME    = '建材・住宅設備の買取専門店レコテック';
const ADMIN_EMAILS = ['info@kenzai-kaitori.jp', 'rebro.web@gmail.com'];
const THANKS_PAGE  = '/form/thanks/';
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
  const referer = request.headers.get('Referer') || '';
  const url = new URL(request.url);
  if (!referer.includes(url.host) && !referer.includes(SITE_DOMAIN)) {
    return redirect(ERROR_PAGE + '?reason=referer');
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

  const productsText = formatProducts(products);
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  // 管理者通知メール
  const adminSubject = '【匿名査定フォーム】お問い合わせがありました';
  const adminBody    = buildAdminBody({ now, name, email, message, productsText });

  await sendMail(apiKey, {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: ADMIN_EMAILS,
    subject: adminSubject,
    text: adminBody,
    reply_to: `${name} <${email}>`,
  });

  // 自動返信メール（送信者宛）
  const replySubject = `【${SITE_NAME}】査定依頼を受け付けました`;
  const replyBody    = buildReplyBody({ name, email, message, productsText });

  await sendMail(apiKey, {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: [email],
    subject: replySubject,
    text: replyBody,
  });

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

// 商品情報を文字列化
function formatProducts(products) {
  if (products.length === 0) return '（商品情報の入力なし）';
  return products.map((p, i) => {
    let s = `■商品${i + 1}\n`;
    if (p.maker)     s += `　メーカー: ${p.maker}\n`;
    if (p.product)   s += `　商品名: ${p.product}\n`;
    if (p.jan)       s += `　JAN・型番: ${p.jan}\n`;
    if (p.qty)       s += `　数量: ${p.qty}\n`;
    if (p.condition) s += `　商品状態: ${p.condition}\n`;
    return s;
  }).join('\n');
}

// 管理者宛メール本文
function buildAdminBody({ now, name, email, message, productsText }) {
  return `${SITE_NAME} の匿名査定フォームから新しい依頼がありました。

────────────────────
■受信日時
${now}

■お名前
${name}

■メールアドレス
${email}

■備考
${message || '（なし）'}

────────────────────
■商品情報
────────────────────
${productsText}
────────────────────`;
}

// 自動返信メール本文（送信者向け）
function buildReplyBody({ name, email, message, productsText }) {
  return `${name} 様

この度は ${SITE_NAME} へお問い合わせいただき、誠にありがとうございます。
以下の内容で査定依頼を受け付けました。

担当者より2営業日以内にご連絡させていただきます。
今しばらくお待ちくださいませ。

────────────────────
■お名前
${name}

■メールアドレス
${email}

■備考
${message || '（なし）'}

────────────────────
■商品情報
────────────────────
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
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}
