const http = require('http');
const net = require('net');

const TARGET_PORT = 5173;
const TARGET_HOST = '127.0.0.1';

const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  headers.host = `${TARGET_HOST}:${TARGET_PORT}`;
  
  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: headers,
  };
  
  const proxy = http.request(options, (targetRes) => {
    res.writeHead(targetRes.statusCode, targetRes.headers);
    targetRes.pipe(res, { end: true });
  });
  
  req.pipe(proxy, { end: true });
  proxy.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Proxy Error: ' + err.message);
  });
});

server.on('upgrade', (req, clientSocket, head) => {
  const serverSocket = net.connect(TARGET_PORT, TARGET_HOST, () => {
    let reqHeader = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      reqHeader += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    reqHeader += '\r\n';
    serverSocket.write(reqHeader);
    if (head && head.length > 0) serverSocket.write(head);
    clientSocket.pipe(serverSocket);
    serverSocket.pipe(clientSocket);
  });
  serverSocket.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => serverSocket.destroy());
});

server.listen(5174, '0.0.0.0', () => {
  console.log(`Port 5174 proxying to http://${TARGET_HOST}:${TARGET_PORT}`);
});

