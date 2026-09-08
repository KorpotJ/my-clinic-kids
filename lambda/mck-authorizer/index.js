// babyplaytime-authorizer
// Verifies the LINE ID token and passes the verified user id to backend Lambdas.
// Must NOT be in a VPC (needs internet to reach api.line.me).

const CHANNEL_ID = process.env.LINE_CHANNEL_ID || '2010547408';

exports.handler = async (event) => {
  try {
    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
      console.log('DENY: no bearer token on request');
      return { isAuthorized: false };
    }
    console.log('Token received. length=', token.length, ' client_id=', CHANNEL_ID);

    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: token, client_id: CHANNEL_ID }),
    });

    // Read the body ONCE as text so we can log it whether or not it's OK.
    const bodyText = await res.text();

    if (!res.ok) {
      // This is the line that will finally tell us the real reason.
      console.error('DENY: LINE verify returned', res.status, '-', bodyText);
      return { isAuthorized: false };
    }

    let data;
    try {
      data = JSON.parse(bodyText);
    } catch (e) {
      console.error('DENY: could not parse LINE verify response:', bodyText);
      return { isAuthorized: false };
    }

    if (!data.sub) {
      console.error('DENY: verify OK but no "sub" in payload:', bodyText);
      return { isAuthorized: false };
    }

    console.log('ALLOW: sub=', data.sub, ' aud=', data.aud);
    return {
      isAuthorized: true,
      context: { lineUserId: data.sub },
    };
  } catch (err) {
    console.error('authorizer error:', err);
    return { isAuthorized: false };
  }
};