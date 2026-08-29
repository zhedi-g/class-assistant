import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 子路径部署：base 必须为 /class-assistant/
// 开发服务器一律 HTTPS（自签名证书）：手机局域网访问时 WebCrypto 与麦克风权限需要安全环境
export default defineConfig({
  base: '/class-assistant/',
  plugins: [
    react(),
    tailwindcss(),
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/pwa-192.png', 'icons/pwa-512.png'],
      manifest: {
        name: '课堂学习助手',
        short_name: '课堂助手',
        description: '实时转写 · 关键词提醒 · AI 答疑 · 资料联合分析 · 复习包',
        lang: 'zh-CN',
        start_url: '/class-assistant/',
        scope: '/class-assistant/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#09090b',
        theme_color: '#09090b',
        icons: [
          { src: '/class-assistant/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/class-assistant/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/class-assistant/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/class-assistant/index.html',
      },
    }),
  ],
  server: { host: true, port: 5173 },
})
