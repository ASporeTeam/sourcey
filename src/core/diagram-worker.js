import process from 'node:process';
import ELK from 'elkjs';
import { darkTheme, defaultTheme, layout, parse, renderSvg } from '@speajus/mermaid-to-svg';

/** Mermaid's line break inside a label. */
const BREAK = /\s*<br\s*\/?>\s*/gi;
/** The parts of a diagram a reader reads: labels, messages, notes and titles, never identifiers. */
const TEXT = new Set(['label', 'text', 'message', 'title', 'description']);

/**
 * Mermaid writes a line break in a label as `<br>`. The renderer draws each
 * line of a flowchart node's label, so there it is a line break; everything
 * else it draws on one line, so there it reads as a space.
 */
function breakLines(ir) {
  const visit = (value, lines) => {
    if (Array.isArray(value)) return value.forEach((item) => visit(item, lines));
    if (!value || typeof value !== 'object') return;
    for (const [key, field] of Object.entries(value)) {
      if (typeof field === 'string' && TEXT.has(key)) value[key] = field.replace(BREAK, lines ? '\n' : ' ');
      else visit(field, false);
    }
  };
  for (const [key, field] of Object.entries(ir)) {
    if (typeof field === 'string' && TEXT.has(key)) ir[key] = field.replace(BREAK, ' ');
    else visit(field, ir.type === 'flowchart' && key === 'nodes');
  }
  return ir;
}

/** The renderer's estimate of text size, measuring each line of a label that has several. */
const metrics = {
  measureText(text, fontSize) {
    const lines = text.split('\n');
    return {
      width: Math.max(...lines.map((line) => line.length)) * fontSize * 0.6,
      height: fontSize * 1.2 + (lines.length - 1) * fontSize * 1.3,
      ascent: fontSize * 0.8,
      descent: fontSize * 0.2,
    };
  },
};

const FONT_SIZE = 14;
/** The space a subgraph keeps above its members for its title, and around them. */
const SUBGRAPH_PADDING = '[top=36,left=16,bottom=16,right=16]';
/** Subgraphs as Mermaid's own default and dark themes colour them. */
const SUBGRAPH_STYLE = {
  default: { fill: '#ffffde', stroke: '#aaaa33', text: '#333333' },
  dark: { fill: '#474949', stroke: 'rgba(255, 255, 255, 0.25)', text: '#e0dfdf' },
};
const elk = new ELK();

/**
 * The renderer lays a flowchart's subgraphs out flat and draws none of them.
 * A flowchart with subgraphs is laid out here instead, each subgraph a
 * container around its members (a node in the innermost subgraph that lists
 * it), in the renderer's own layered layout and node sizes, so its nodes and
 * edges draw as before and its subgraphs can be drawn beneath them.
 */
async function layoutSubgraphs(ir) {
  const subgraphs = new Map(ir.subgraphs.map((subgraph) => [subgraph.id, subgraph]));
  const parent = new Map();
  // Inner subgraphs come first, so a node's first subgraph is its innermost.
  for (const subgraph of ir.subgraphs) for (const id of subgraph.nodeIds) if (!parent.has(id)) parent.set(id, subgraph.id);
  const size = (label, shape) => {
    const text = metrics.measureText(label, FONT_SIZE);
    const box = { width: Math.max(text.width + 24, 60), height: Math.max(text.height + 24, 40) };
    return shape === 'diamond' ? { width: box.width * 1.4, height: box.height * 1.4 } : box;
  };
  const elkNode = new Map();
  for (const node of ir.nodes) if (!subgraphs.has(node.id)) elkNode.set(node.id, { id: node.id, ...size(node.label, node.shape), labels: [{ text: node.label }] });
  // A subgraph is at least as wide as its title. ELK 0.9 reads a nested node's minimum size with
  // its axes swapped when the layout runs top to bottom or bottom to top, so it is given that way.
  const vertical = !['LR', 'RL'].includes(ir.direction);
  for (const subgraph of ir.subgraphs) {
    const width = metrics.measureText(subgraph.label, FONT_SIZE).width + 32;
    elkNode.set(subgraph.id, { id: subgraph.id, layoutOptions: { 'elk.padding': SUBGRAPH_PADDING, 'elk.nodeSize.constraints': 'MINIMUM_SIZE', 'elk.nodeSize.minimum': vertical ? `(40,${width})` : `(${width},40)` }, children: [] });
  }
  const roots = [];
  for (const [id, node] of elkNode) (parent.has(id) ? elkNode.get(parent.get(id)).children : roots).push(node);
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': { LR: 'RIGHT', RL: 'LEFT', BT: 'UP' }[ir.direction] ?? 'DOWN',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    },
    children: roots,
    edges: ir.edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target], labels: edge.label ? [{ text: edge.label, width: edge.label.length * FONT_SIZE * 0.6, height: FONT_SIZE * 1.2 }] : [] })),
  };
  const laid = await elk.layout(graph);
  // ELK places a node within its parent and an edge within the container it names; both are drawn on the page.
  const placed = new Map([['root', { x: 0, y: 0, width: laid.width, height: laid.height }]]);
  const walk = (node, left, top) => {
    const at = { x: left + node.x, y: top + node.y, width: node.width, height: node.height };
    placed.set(node.id, at);
    for (const child of node.children ?? []) walk(child, at.x, at.y);
  };
  for (const node of laid.children ?? []) walk(node, 0, 0);
  const nodes = ir.nodes.filter((node) => !subgraphs.has(node.id)).map((node) => {
    const at = placed.get(node.id);
    return { id: node.id, x: at.x, y: at.y, width: at.width, height: at.height, label: node.label, shape: node.shape };
  });
  const edges = (laid.edges ?? []).map((edge) => {
    const source = ir.edges.find((item) => item.id === edge.id);
    const container = placed.get(edge.container ?? 'root');
    const points = (edge.sections ?? []).flatMap((section) => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].filter(Boolean)).map((point) => ({ x: container.x + point.x, y: container.y + point.y }));
    return { id: edge.id, source: source.source, target: source.target, label: source.label, points, type: source.type, arrowHead: source.arrowHead };
  });
  // Outer subgraphs first, so an inner one draws over the one around it.
  const depth = (id) => (parent.has(id) ? 1 + depth(parent.get(id)) : 0);
  const boxes = ir.subgraphs.map((subgraph) => ({ ...subgraph, ...pick(placed.get(subgraph.id)) })).sort((a, b) => depth(a.id) - depth(b.id));
  const extent = [...nodes, ...boxes];
  return {
    diagramType: 'flowchart',
    nodes,
    edges,
    subgraphs: boxes,
    width: Math.max(...extent.map((item) => item.x + item.width)) + 40,
    height: Math.max(...extent.map((item) => item.y + item.height)) + 40,
  };
}

const pick = ({ x, y, width, height }) => ({ x, y, width, height });
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Subgraph containers and their titles, drawn under the edges and nodes. */
function drawSubgraphs(svg, positioned, dark) {
  if (!positioned.subgraphs?.length) return svg;
  const style = SUBGRAPH_STYLE[dark ? 'dark' : 'default'];
  const boxes = positioned.subgraphs.map((box) => `<g><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" ry="4" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1"></rect><text x="${box.x + box.width / 2}" y="${box.y + 22}" text-anchor="middle" font-size="${FONT_SIZE}" font-family="&quot;trebuchet ms&quot;, verdana, arial, sans-serif" fill="${style.text}">${escape(box.label)}</text></g>`).join('');
  const defs = svg.indexOf('</defs>');
  return defs < 0 ? svg : `${svg.slice(0, defs + 7)}${boxes}${svg.slice(defs + 7)}`;
}

/** The node style the renderer gives each shape, for its text colour. */
const SHAPE_STYLE = { diamond: 'decision', rounded: 'rounded', stadium: 'rounded', circle: 'circle', 'double-circle': 'circle', cylinder: 'cylinder', subroutine: 'subroutine' };

/**
 * The renderer draws a label of several lines without the text's own height,
 * so its lines land at the top of the diagram. Such labels are taken out of
 * the nodes before drawing and returned with their places, to be drawn over
 * the nodes at their centres.
 */
function takeMultilineLabels(positioned) {
  const taken = [];
  for (const node of positioned.nodes ?? []) {
    if (typeof node.label !== 'string' || !node.label.includes('\n')) continue;
    taken.push({ lines: node.label.split('\n'), x: node.x + node.width / 2, y: node.y + node.height / 2, shape: node.shape });
    node.label = '';
  }
  return taken;
}

function drawLabels(svg, labels, dark) {
  if (!labels.length) return svg;
  const theme = dark ? darkTheme : defaultTheme;
  const lineHeight = theme.fontSize * 1.3;
  const text = labels.map(({ lines, x, y, shape }) => {
    const fill = (theme.nodeStyles[SHAPE_STYLE[shape]] ?? theme.nodeStyles.default).textColor;
    const top = y - ((lines.length - 1) * lineHeight) / 2;
    return `<text x="${x}" y="${top}" font-size="${theme.fontSize}" font-family="${escape(theme.fontFamily)}" fill="${fill}" text-anchor="middle" dominant-baseline="central">${lines.map((line, index) => `<tspan x="${x}" y="${top + index * lineHeight}">${escape(line)}</tspan>`).join('')}</text>`;
  }).join('');
  return svg.replace(/<\/svg>\s*$/, `${text}</svg>`);
}

// The build's diagram renderer, in a process of its own: one diagram at a time.
let queue = Promise.resolve();
process.on('message', request => {
  queue = queue.then(async () => {
    try {
      const ir = breakLines(await parse(request.source));
      const positioned = ir.type === 'flowchart' && ir.subgraphs?.length ? await layoutSubgraphs(ir) : await layout(ir, { fontMetrics: metrics });
      const labels = takeMultilineLabels(positioned);
      const svg = renderSvg(positioned, request.dark ? 'dark' : 'default', request.prefix);
      process.send({ id: request.id, svg: drawLabels(drawSubgraphs(svg, positioned, request.dark), labels, request.dark) });
    } catch (error) {
      process.send({ id: request.id, error: error.message });
    }
  });
});
