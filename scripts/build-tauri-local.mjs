import { build } from 'vite'
import { getServerViteConfig, servers } from '../config/building/vite.config.servers.mjs'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync } from 'node:fs'
import { resolve } from 'node:path'
for (const id of Object.keys(servers)) {
    const config = getServerViteConfig(id, true)
    config.configFile = false
    config.plugins = config.plugins.filter(p => p.name !== 'copy-server-files')
    config.build.outDir = resolve(`dist-local/${id}`)
    config.build.minify = 'esbuild'
    await build(config)
    const dir = config.build.outDir
    let html = readFileSync(`src/server/${id}/index.html`, 'utf8')
    html = html.replace(/<script>[^]*?serviceWorker[^]*?<\/script>/g, '')
    if (id === 'stage' || id === 'output_stream') {
        html = html.replace('</head>', '<link rel="stylesheet" href="fonts/google/fonts.css" /></head>')
        cpSync('public/fonts/google', `${dir}/fonts/google`, { recursive: true })
    }
    writeFileSync(`${dir}/index.html`, html)
    copyFileSync(`src/server/${id}/manifest.json`, `${dir}/manifest.json`)
    copyFileSync('src/server/icon.png', `${dir}/icon.png`)
    if (id === 'stage') {
        mkdirSync(`${dir}/html`, { recursive: true })
        for (const file of ['navigation.js', 'show.css']) copyFileSync(`src/server/stage/html/${file}`, `${dir}/html/${file}`)
    }
}
