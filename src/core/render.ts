// Два способа нарисовать примитивы сцены: строкой SVG (редактор, плеер) и на
// канвасе (кадры видео).
import { Rect } from './layout';
import { Prim } from './scene';
import { Theme } from './theme';

const n = (value: number) => String(Math.round(value * 100) / 100);

export function escapeXml(text: string): string {
    return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function attr(name: string, value: string | number | undefined): string {
    if (value === undefined || value === '') return '';
    return ` ${name}="${typeof value === 'number' ? n(value) : escapeXml(value)}"`;
}

function paint(fill?: string, stroke?: string, width?: number, dash?: string): string {
    return attr('fill', fill ?? 'none') + attr('stroke', stroke) + (stroke ? attr('stroke-width', width ?? 1) : '') + attr('stroke-dasharray', dash);
}

export function primsToSvg(prims: Prim[], theme: Theme): string {
    let out = '';
    const write = (p: Prim) => {
        switch (p.t) {
            case 'group': {
                if (p.opacity !== undefined && p.opacity <= 0.001) return;
                out += `<g${attr('data-id', p.id)}${p.opacity !== undefined && p.opacity < 0.999 ? attr('opacity', p.opacity) : ''}>`;
                if (p.hit) out += `<rect class="sda-hit"${attr('x', p.hit.x - 4)}${attr('y', p.hit.y - 2)}${attr('width', p.hit.w + 8)}${attr('height', p.hit.h + 4)} fill="transparent"/>`;
                p.items.forEach(write);
                out += '</g>';
                return;
            }
            case 'line':
                out += `<line${attr('x1', p.x1)}${attr('y1', p.y1)}${attr('x2', p.x2)}${attr('y2', p.y2)}${paint(undefined, p.stroke, p.w, p.dash)}/>`;
                return;
            case 'poly': {
                const points = [];
                for (let i = 0; i < p.pts.length; i += 2) points.push(`${n(p.pts[i])},${n(p.pts[i + 1])}`);
                const tag = p.close ? 'polygon' : 'polyline';
                out += `<${tag} points="${points.join(' ')}"${paint(p.fill, p.stroke, p.w, p.dash)} stroke-linejoin="round" stroke-linecap="round"/>`;
                return;
            }
            case 'rect':
                out += `<rect${attr('x', p.x)}${attr('y', p.y)}${attr('width', Math.max(0, p.w))}${attr('height', Math.max(0, p.h))}${p.r ? attr('rx', p.r) : ''}${paint(p.fill, p.stroke, p.sw, p.dash)}/>`;
                return;
            case 'path':
                out += `<path d="${p.d}"${paint(p.fill, p.stroke, p.sw)}/>`;
                return;
            case 'ellipse':
                out += `<ellipse${attr('cx', p.cx)}${attr('cy', p.cy)}${attr('rx', p.rx)}${attr('ry', p.ry)}${paint(p.fill, p.stroke, p.sw)}/>`;
                return;
            case 'text': {
                const halo = p.halo ? `${attr('stroke', p.halo)} stroke-width="4" stroke-linejoin="round" paint-order="stroke"` : '';
                out +=
                    `<text${attr('x', p.x)}${attr('y', p.y)}${attr('font-family', p.mono ? theme.mono : theme.font)}${attr('font-size', p.size)}` +
                    `${p.weight && p.weight !== 400 ? attr('font-weight', p.weight) : ''}${p.italic ? ' font-style="italic"' : ''}` +
                    `${p.anchor && p.anchor !== 'start' ? attr('text-anchor', p.anchor) : ''}${attr('fill', p.fill)}${halo} xml:space="preserve">${escapeXml(p.s)}</text>`;
                return;
            }
        }
    };
    prims.forEach(write);
    return out;
}

export function svgDocument(prims: Prim[], theme: Theme, view: Rect, size?: { width: number; height: number }): string {
    const dims = size ? ` width="${size.width}" height="${size.height}"` : '';
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(view.x)} ${n(view.y)} ${n(view.w)} ${n(view.h)}"${dims}>` +
        `<rect x="${n(view.x - view.w)}" y="${n(view.y - view.h)}" width="${n(view.w * 3)}" height="${n(view.h * 3)}" fill="${theme.colors.background}"/>` +
        primsToSvg(prims, theme) +
        '</svg>'
    );
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function dashOf(dash?: string): number[] {
    return dash ? dash.split(/[ ,]+/).map(Number) : [];
}

export function drawPrims(ctx: Context2D, prims: Prim[], theme: Theme): void {
    const draw = (p: Prim) => {
        switch (p.t) {
            case 'group': {
                if (p.opacity !== undefined && p.opacity <= 0.001) return;
                ctx.save();
                if (p.opacity !== undefined) ctx.globalAlpha *= p.opacity;
                p.items.forEach(draw);
                ctx.restore();
                return;
            }
            case 'line':
                ctx.beginPath();
                ctx.moveTo(p.x1, p.y1);
                ctx.lineTo(p.x2, p.y2);
                stroke(p.stroke, p.w, p.dash);
                return;
            case 'poly':
                ctx.beginPath();
                ctx.moveTo(p.pts[0], p.pts[1]);
                for (let i = 2; i < p.pts.length; i += 2) ctx.lineTo(p.pts[i], p.pts[i + 1]);
                if (p.close) ctx.closePath();
                if (p.fill) {
                    ctx.fillStyle = p.fill;
                    ctx.fill();
                }
                if (p.stroke) stroke(p.stroke, p.w ?? 1, p.dash);
                return;
            case 'rect':
                ctx.beginPath();
                if (p.r && 'roundRect' in ctx) ctx.roundRect(p.x, p.y, Math.max(0, p.w), Math.max(0, p.h), Math.min(p.r, p.w / 2, p.h / 2));
                else ctx.rect(p.x, p.y, Math.max(0, p.w), Math.max(0, p.h));
                if (p.fill) {
                    ctx.fillStyle = p.fill;
                    ctx.fill();
                }
                if (p.stroke) stroke(p.stroke, p.sw ?? 1, p.dash);
                return;
            case 'path': {
                const path = new Path2D(p.d);
                if (p.fill) {
                    ctx.fillStyle = p.fill;
                    ctx.fill(path);
                }
                if (p.stroke) {
                    ctx.setLineDash([]);
                    ctx.lineWidth = p.sw ?? 1;
                    ctx.strokeStyle = p.stroke;
                    ctx.stroke(path);
                }
                return;
            }
            case 'ellipse':
                ctx.beginPath();
                ctx.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, Math.PI * 2);
                if (p.fill) {
                    ctx.fillStyle = p.fill;
                    ctx.fill();
                }
                if (p.stroke) stroke(p.stroke, p.sw ?? 1);
                return;
            case 'text': {
                ctx.font = `${p.italic ? 'italic ' : ''}${p.weight ?? 400} ${p.size}px ${p.mono ? theme.mono : theme.font}`;
                ctx.textAlign = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left';
                ctx.textBaseline = 'alphabetic';
                if (p.halo) {
                    ctx.setLineDash([]);
                    ctx.lineJoin = 'round';
                    ctx.lineWidth = 4;
                    ctx.strokeStyle = p.halo;
                    ctx.strokeText(p.s, p.x, p.y);
                }
                ctx.fillStyle = p.fill;
                ctx.fillText(p.s, p.x, p.y);
                return;
            }
        }
    };
    const stroke = (color: string, width: number, dash?: string) => {
        ctx.setLineDash(dashOf(dash));
        ctx.lineWidth = width;
        ctx.lineCap = dash ? 'butt' : 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = color;
        ctx.stroke();
    };
    prims.forEach(draw);
}
