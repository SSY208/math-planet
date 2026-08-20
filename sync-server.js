#!/usr/bin/env node
/**
 * 数学星球 · 云端同步服务器 (Math Planet Sync Server)
 *
 * 零依赖、纯 Node 实现。两台设备通过它实时互通学习进度。
 *
 * 启动:  node sync-server.js            (默认端口 8787)
 * 或:    PORT=8080 node sync-server.js
 *
 * 协议:
 *   GET  /sync/<room>  读取该房间的进度 JSON（不存在返回 404）
 *   PUT  /sync/<room>  写入该房间的进度 JSON（请求体即完整进度）
 *   GET  /            健康检查
 *
 * 数据保存在 ./data/<room>.json（自动创建目录）。
 * 允许任何来源跨域访问（CORS *），供 GitHub Pages 上的网页调用。
 *
 * 免费部署参考（任选其一）:
 *   - Render: https://render.com 新建 Web Service → 连接本仓库 →
 *     Start Command 填 `node sync-server.js`（免费额度每月 750 小时）
 *   - Railway / Fly.io / 家里的电脑 / 任何有 Node 的服务器
 *   部署后把 https://你的域名 填入 App 的“同步服务器地址”。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8787;
const DATA_DIR = path.join(__dirname, 'data');
const MAX_BODY = 512 * 1024; // 512 KB

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

function roomFile(room) {
  return path.join(DATA_DIR, room + '.json');
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/' || url.pathname === '/health') {
    sendJson(res, 200, { ok: true, name: 'math-planet-sync', time: Date.now() });
    return;
  }

  const m = url.pathname.match(/^\/sync\/([A-Za-z0-9_-]{1,64})$/);
  if (!m) { sendJson(res, 404, { error: 'not found' }); return; }
  const room = m[1];
  if (!ROOM_RE.test(room)) { sendJson(res, 400, { error: 'bad room' }); return; }

  const file = roomFile(room);

  if (req.method === 'GET') {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(raw);
    } catch (e) {
      sendJson(res, 404, { error: 'room not found' });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body); }
      catch (e) { sendJson(res, 400, { error: 'invalid JSON' }); return; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendJson(res, 400, { error: 'expected JSON object' }); return;
      }
      // 原子写入：先写临时文件再重命名
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(parsed), 'utf8');
      fs.renameSync(tmp, file);
      sendJson(res, 200, { ok: true, room: room, size: Buffer.byteLength(JSON.stringify(parsed)) });
    } catch (e) {
      sendJson(res, e.message === 'body too large' ? 413 : 500, { error: e.message || 'server error' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try { fs.unlinkSync(file); sendJson(res, 200, { ok: true }); }
    catch (e) { sendJson(res, 404, { error: 'room not found' }); }
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, () => {
  console.log(`Math Planet sync server running at http://0.0.0.0:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
