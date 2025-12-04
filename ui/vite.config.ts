import { defineConfig, loadEnv } from 'vite';
import tsConfigPaths from 'vite-tsconfig-paths';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { unsealData } from 'iron-session';
import { decodeJwt } from 'jose';
import type { Plugin } from 'vite';

// Request logging utilities
async function extractUserInfoFromRequest(req: any): Promise<{ userId: string; orgId: string }> {
  try {
    const cookieName = process.env.WORKOS_COOKIE_NAME || 'wos-session';
    const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD;
    
    if (!cookiePassword) {
      return { userId: 'anonymous', orgId: 'anonymous' };
    }
    
    const cookieHeader = req.headers?.cookie || req.getHeader?.('cookie');
    if (!cookieHeader) {
      return { userId: 'anonymous', orgId: 'anonymous' };
    }
    
    const cookies = cookieHeader.split(';').reduce((acc: Record<string, string>, cookie: string) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
    
    const sessionCookie = cookies[cookieName];
    if (!sessionCookie) {
      return { userId: 'anonymous', orgId: 'anonymous' };
    }
    
    const session = await unsealData(sessionCookie, {
      password: cookiePassword,
    }) as { user?: { id?: string }; accessToken?: string };
    
    if (!session?.user?.id || !session?.accessToken) {
      return { userId: 'anonymous', orgId: 'anonymous' };
    }
    
    // Decode JWT to get organization ID
    let orgId = 'anonymous';
    try {
      const decoded = decodeJwt<{ org_id?: string }>(session.accessToken);
      orgId = decoded.org_id || 'anonymous';
    } catch (error) {
      // If JWT decode fails, just use anonymous
    }
    
    return { userId: session.user.id, orgId };
  } catch (error) {
    return { userId: 'anonymous', orgId: 'anonymous' };
  }
}

function logRequestInit(method: string, path: string, requestId: string, userId: string, orgId: string) {
  console.log(JSON.stringify({
    event: 'request_initialized',
    method,
    path,
    requestId,
    userId,
    orgId,
  }));
}

function logResponse(method: string, path: string, requestId: string, latency: number, statusCode: number) {
  console.log(JSON.stringify({
    event: 'response_sent',
    method,
    path,
    requestId,
    latency,
    statusCode,
  }));
}

// Logging middleware plugin
function requestLoggingPlugin(): Plugin {
  return {
    name: 'request-logging',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const existingRequestId = req.headers['x-request-id'];
        const requestId = Array.isArray(existingRequestId) 
          ? existingRequestId[0] 
          : existingRequestId || `ssr-${Math.random().toString(36).slice(2, 10)}`;
        const requestStart = Date.now();
        
        const pathname = req.url?.split('?')[0] || '/';
        const method = req.method || 'GET';
        
        // Extract user ID and org ID and log request initialization
        const { userId, orgId } = await extractUserInfoFromRequest(req);
        logRequestInit(method, pathname, requestId, userId, orgId);
        
        // Set request ID header
        req.headers['x-request-id'] = requestId;
        
        // Capture original end function to log response
        const originalEnd = res.end.bind(res);
        res.end = function(...args: any[]) {
          const latency = Date.now() - requestStart;
          logResponse(method, pathname, requestId, latency, res.statusCode || 200);
          return originalEnd(...args);
        };
        
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  
  const env = loadEnv(mode, process.cwd(), '');
  const allowedHosts = (env.ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  return {
    ssr: {
      // Force native Node resolution at runtime (no inlining)
      external: ['@workos-inc/node'],
      // Do NOT list it in noExternal (that would inline/transform it)
    },   
    server: {
      port: 3030,
      allowedHosts,
    },
    plugins: [
      tsConfigPaths({
        projects: ['./tsconfig.json'],
      }),
      requestLoggingPlugin(),
      tanstackStart(),
      viteReact(),
      // cloudflare({ viteEnvironment: { name: 'ssr' } }),
    ],
  };
});
