import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Одна игра — несколько площадок. Площадка выбирается при сборке:
//   npm run build         → Яндекс Игры (папка dist)
//   npm run build:vk      → VK Games: ВКонтакте и Одноклассники (папка dist-vk)
//   npm run build:mobile  → один html-файл для своего телефона, без площадок (папка dist-mobile)
// Код площадки подставляется вместо импорта '@platform' из src/platform/<площадка>.ts
const target = process.env.PLATFORM === 'vk' ? 'vk' : process.env.PLATFORM === 'web' ? 'web' : 'yandex'
// Своя версия без площадки работает на заглушках из yandex.ts: без SDK они включаются сами
const platform = target === 'vk' ? 'vk' : 'yandex'

// SDK Яндекса нужен только в сборке для Яндекса
const stripYandexSdk = (): Plugin => ({
  name: 'strip-yandex-sdk',
  transformIndexHtml: html => (target === 'yandex' ? html : html.replace(/\s*<!--[^>]*Yandex[^>]*-->\s*<script src="\/sdk\.js"><\/script>/, '')),
})

// base: './' — игра работает из любой папки, как требуют обе площадки.
// SINGLE=1 — собрать всё в один html-файл (для быстрого показа).
export default defineConfig({
  base: './',
  define: { 'import.meta.env.VITE_TARGET': JSON.stringify(target) },
  resolve: {
    alias: { '@platform': fileURLToPath(new URL(`./src/platform/${platform}.ts`, import.meta.url)) },
  },
  plugins: [react(), stripYandexSdk(), ...(process.env.SINGLE ? [viteSingleFile()] : [])],
})
