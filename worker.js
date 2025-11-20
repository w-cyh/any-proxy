/**
 * Cloudflare Worker - anyrouter.top 反向代理
 */

const TARGET_HOST = 'anyrouter.top';
const TARGET_URL = `https://${TARGET_HOST}`;

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  try {
    const url = new URL(request.url);
    const targetUrl = `${TARGET_URL}${url.pathname}${url.search}`;

    // 复制并修改请求头
    const headers = new Headers(request.headers);
    headers.set('Host', TARGET_HOST);
    
    // 移除可能引起问题的头
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ray');
    headers.delete('cf-ipcountry');
    headers.delete('cf-visitor');

    // 处理 Origin 和 Referer
    if (headers.has('Origin')) {
      const origin = headers.get('Origin');
      try {
        const originUrl = new URL(origin);
        if (originUrl.hostname === new URL(request.url).hostname) {
          headers.set('Origin', TARGET_URL);
        }
      } catch (e) {
        // 忽略无效的 Origin
      }
    }

    if (headers.has('Referer')) {
      const referer = headers.get('Referer');
      try {
        const refererUrl = new URL(referer);
        if (refererUrl.hostname === new URL(request.url).hostname) {
          headers.set('Referer', `${TARGET_URL}${refererUrl.pathname}${refererUrl.search}`);
        }
      } catch (e) {
        // 忽略无效的 Referer
      }
    }

    // 构建请求选项
    const requestOptions = {
      method: request.method,
      headers: headers,
      redirect: 'manual',
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      requestOptions.body = request.body;
    }

    // 发起请求
    const response = await fetch(targetUrl, requestOptions);

    // 改进的重定向处理
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      
      if (location) {
        try {
          const locationUrl = new URL(location, TARGET_URL);
          
          // 如果重定向到目标网站内部，修改为重定向到代理
          if (locationUrl.hostname === TARGET_HOST) {
            const proxyUrl = new URL(request.url);
            const newLocation = `${proxyUrl.origin}${locationUrl.pathname}${locationUrl.search}`;
            
            return new Response(null, {
              status: response.status,
              headers: {
                'Location': newLocation,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*',
              }
            });
          } else {
            // 外部重定向，直接转发
            return new Response(null, {
              status: response.status,
              headers: {
                'Location': location,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*',
              }
            });
          }
        } catch (e) {
          // 处理相对路径重定向
          if (location.startsWith('/')) {
            const proxyUrl = new URL(request.url);
            const newLocation = `${proxyUrl.origin}${location}`;
            
            return new Response(null, {
              status: response.status,
              headers: {
                'Location': newLocation,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*',
              }
            });
          }
        }
      }
    }

    // 处理响应
    const responseHeaders = new Headers(response.headers);
    
    // 设置 CORS
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', '*');
    
    // 移除安全头
    responseHeaders.delete('Content-Security-Policy');
    responseHeaders.delete('X-Frame-Options');
    responseHeaders.delete('X-Content-Type-Options');

    const contentType = responseHeaders.get('content-type') || '';
    const isTextContent = /text\/|application\/javascript|application\/json|application\/xml|font\//.test(contentType);

    if (isTextContent) {
      const text = await response.text();
      const rewrittenText = rewriteUrlsInContent(text, request.url);
      
      return new Response(rewrittenText, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }

    // 二进制内容直接返回
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });

  } catch (error) {
    console.error('代理请求失败:', error);
    return new Response(`代理请求失败: ${error.message}`, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

/**
 * 改进的 URL 重写函数
 */
function rewriteUrlsInContent(content, proxyUrl) {
  try {
    const proxyOrigin = new URL(proxyUrl).origin;
    let rewritten = content;

    // 1. 重写完整 URL
    rewritten = rewritten.replace(
      new RegExp(`https?://${TARGET_HOST}`, 'gi'),
      proxyOrigin
    );

    // 2. 重写协议相对 URL
    rewritten = rewritten.replace(
      new RegExp(`//${TARGET_HOST}`, 'gi'),
      `//${new URL(proxyUrl).hostname}`
    );

    // 3. 重写 JSON 中的 URL（常见于 API 响应）
    rewritten = rewritten.replace(
      new RegExp(`"https?://${TARGET_HOST}`, 'gi'),
      `"${proxyOrigin}`
    );

    return rewritten;
  } catch (error) {
    console.error('URL 重写失败:', error);
    return content;
  }
}
