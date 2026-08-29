import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// 开发服务器一律走 HTTPS（自签名证书）：
// 手机局域网访问时，WebCrypto（讯飞鉴权签名）与麦克风权限均要求安全环境，
// 否则点「开始上课」会报“当前环境不支持加密模块”。首次访问需手动信任证书。
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: { host: true, port: 5173 },
})
