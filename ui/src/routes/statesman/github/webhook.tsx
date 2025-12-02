import { createFileRoute } from '@tanstack/react-router';

// GitHub webhook passthrough to Statesman
// This route receives GitHub webhooks and forwards them to the internal Statesman service
// Enable by setting STATESMAN_GITHUB_WEBHOOK_ENABLED=true
export const Route = createFileRoute('/statesman/github/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Check if GitHub webhook is enabled
        if (process.env.STATESMAN_GITHUB_WEBHOOK_ENABLED !== 'true') {
          console.log('GitHub webhook disabled (STATESMAN_GITHUB_WEBHOOK_ENABLED not set)');
          return new Response(JSON.stringify({ error: 'GitHub webhook not enabled' }), { 
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const statesmanUrl = process.env.STATESMAN_BACKEND_URL;
        if (!statesmanUrl) {
          console.error('STATESMAN_BACKEND_URL not configured');
          return new Response(JSON.stringify({ error: 'Backend not configured' }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        try {
          console.log('Forwarding GitHub webhook to Statesman');
          
          // Forward all headers (including GitHub signature headers)
          const response = await fetch(`${statesmanUrl}/webhooks/github`, {
            method: 'POST',
            headers: request.headers,
            body: request.body,
            // @ts-expect-error: 'duplex' is required by Node/undici for streaming bodies
            duplex: 'half',
          });

          // Return the response from Statesman
          const responseBody = await response.text();
          return new Response(responseBody, {
            status: response.status,
            headers: {
              'Content-Type': response.headers.get('Content-Type') || 'application/json',
            },
          });
        } catch (error) {
          console.error('Error forwarding GitHub webhook to Statesman:', error);
          return new Response(JSON.stringify({ error: 'Internal server error' }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      },
    },
  },
});

