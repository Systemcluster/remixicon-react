import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import process from 'node:process'

import { sync as globSync } from 'glob'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import { rollup } from 'rollup'
import { swc } from 'rollup-plugin-swc3'

if (fs.existsSync('dist')) fs.rmSync('dist', { recursive: true })
if (fs.existsSync('build')) fs.rmSync('build', { recursive: true })

fs.mkdirSync('dist', { recursive: true })
fs.mkdirSync('build', { recursive: true })

const require = createRequire(import.meta.url)

let remixicon = ''
try {
    remixicon = path.normalize(path.dirname(require.resolve('remixicon/package.json'))).replaceAll('\\', '/')
} catch (error) {
    console.error('Could not find "remixicon" in the dependencies. Please install remixicon.')
    console.error(`${error.name}: ${error.message}`)
    process.exit(1)
}
const files = globSync(remixicon + '/icons/**/*.svg', { absolute: true })

const header = `
import { ComponentType, SVGProps, memo } from 'react';

type AllSVGProps = SVGProps<SVGSVGElement>

type ReservedProps = 'color' | 'size' | 'width' | 'height' | 'fill' | 'viewBox'

export interface RemixiconReactIconProps extends Pick<AllSVGProps, Exclude<keyof AllSVGProps, ReservedProps>> {
  color?: string;
  size?: number | string;
  children?: never;
}
export type RemixiconReactIconComponentType = ComponentType<RemixiconReactIconProps>;
`

const componentTemplate = (name, path) => `
export const ${name}: RemixiconReactIconComponentType = memo(
    function ${name}({ color = 'currentColor', size = 24, children, ...props }) {
        const className = 'remixicon-icon ' + (props.className || '');
        return (
            <svg {...props} className={className} width={size} height={size} fill={color} viewBox="0 0 24 24">
                <path d="${path}" />
            </svg>
        );
    }
);
`

const svgPathRegex = /<path\s([^>]*)>/g
const svgAttrRegex = /(?:\s*|^)([^= ]*)="([^"]*)"/g

const checkAllowedAttr = (attr, value) => {
    if (attr === 'd') return true
    if (attr === 'fill') {
        if (value === 'none') return true
        if (value === '#000') return true
    }
    if (attr === 'fill-rule' && value === 'nonzero') return true
    return false
}

const components = await Promise.all(
    files.map(async (file) => {
        const name = path.basename(file, '.svg')
        const componentName =
            'Icon' + name.replace(/-([a-z0-9])/g, (g) => g[1].toUpperCase()).replace(/^([a-z])/, (g) => g.toUpperCase())
        const content = await new Promise((resolve, reject) =>
            fs.readFile(file, { encoding: 'utf-8' }, (err, data) => (err ? reject(err) : resolve(data)))
        )
        const allPaths = []
        while (true) {
            const svgPathMatches = svgPathRegex.exec(content)
            const svgPath = svgPathMatches && svgPathMatches[1]
            if (!svgPath) {
                break
            }
            const attrs = {}
            while (true) {
                const svgAttrMatches = svgAttrRegex.exec(svgPath)
                if (!svgAttrMatches) {
                    break
                }
                if (!checkAllowedAttr(svgAttrMatches[1], svgAttrMatches[2])) {
                    throw new Error(`Unknown SVG attr in ${name}: ${svgAttrMatches[1]}="${svgAttrMatches[2]}"\n${content}`)
                }
                attrs[svgAttrMatches[1]] = svgAttrMatches[2]
            }
            if (attrs.fill === 'none') {
                continue
            }
            allPaths.push(attrs)
        }
        if (allPaths.length !== 1 || !allPaths[0].d) {
            throw new Error(
                `Wrong number of path in ${name}: ${allPaths.length}\n` + `${JSON.stringify(allPaths, undefined, 2)}\n${content}`
            )
        }
        const svgPath = allPaths[0].d

        return componentTemplate(componentName, svgPath)
    })
)

const source = header + components.join('')
fs.writeFileSync('build/index.tsx', source)

const bundle = await rollup({
    input: 'build/index.tsx',
    external: ['react', 'react/jsx-runtime'],
    plugins: [
        nodeResolve({
            rootDir: '../node_modules',
        }),
        swc({
            tsconfig: '../tsconfig.json',
            swcrc: true,
        }),
    ],
})

await bundle.write({
    file: 'dist/index.js',
    format: 'es',
    strict: true,
    sourcemap: false,
    esModule: true,
    exports: 'named',
})
