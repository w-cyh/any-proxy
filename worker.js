/**
 * Cloudflare Worker - anyrouter.top 反向代理 (ES Module 版本)
 */

const TARGET_HOST = 'anyrouter.top';
const TARGET_URL = `https://${TARGET_HOST}`;

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const targetUrl = `${TARGET_URL}${url.pathname}${url.search}`;

      console.log('收到请求:', request.url);
      console.log('目标URL:', targetUrl);

      // 复制并修改请求头
      const headers = new Headers(request.headers);
      headers.set('Host', TARGET_HOST);
      
      // 移除 Cloudflare 特定头
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
      console.log('发起请求到:', targetUrl);
      const response = await fetch(targetUrl, requestOptions);
      console.log('目标响应状态:', response.status, response.statusText);

      // 处理重定向
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        console.log('检测到重定向，Location:', location);

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
      console.log('内容类型:', contentType);

      const isTextContent = /text\/|application\/javascript|application\/json|application\/xml|font\//.test(contentType);

      if (isTextContent) {
        try {
          console.log('尝试读取文本内容...');
          const text = await response.text();
          console.log('文本长度:', text.length);
          const rewrittenText = rewriteUrlsInContent(text, request.url);
          console.log('URL 重写完成，返回响应');

          return new Response(rewrittenText, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
          });
        } catch (error) {
          console.error('文本转换失败:', error);
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders
          });
        }
      }

      // 对于二进制文件，直接返回原始响应
      console.log('直接返回二进制内容');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });

    } catch (error) {
      console.error('代理请求失败:', error);
      console.error('错误堆栈:', error.stack);
      return new Response(`代理请求失败: ${error.message}`, {
        status: 500,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
}

/**
 * 重写内容中的绝对 URL
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

    // 3. 重写 JSON 中的 URL
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
