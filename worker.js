export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const headers = {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers });
        }

        if (url.pathname === '/data' && request.method === 'GET') {
            const data = await env.ROOSTER_KV.get('rooster_data');
            return new Response(data || '{}', { headers });
        }

        if (url.pathname === '/data' && request.method === 'PUT') {
            const body = await request.text();
            await env.ROOSTER_KV.put('rooster_data', body);
            return new Response(JSON.stringify({ ok: true }), { headers });
        }

        return new Response('Not found', { status: 404, headers });
    }
};
