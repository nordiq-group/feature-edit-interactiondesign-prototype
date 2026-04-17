import 'ol/ol.css';
import Feature from 'ol/Feature';
import OlMap from 'ol/Map';
import View from 'ol/View';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import OSM from 'ol/source/OSM';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import { fromLonLat } from 'ol/proj';
import { singleClick } from 'ol/events/condition';

// Unmistakable "this file executed" signal.
console.log('[main.ts] module loaded');
document.documentElement.dataset.mainTsLoaded = 'true';
const bootBadge = document.createElement('div');
bootBadge.textContent = 'main.ts loaded';
bootBadge.style.position = 'fixed';
bootBadge.style.right = '10px';
bootBadge.style.bottom = '10px';
bootBadge.style.zIndex = '9999';
bootBadge.style.padding = '6px 10px';
bootBadge.style.borderRadius = '6px';
bootBadge.style.font = '12px/1.2 monospace';
bootBadge.style.background = 'rgba(16, 81, 103, 0.95)';
bootBadge.style.border = '1px solid rgba(134, 182, 198, 0.8)';
bootBadge.style.color = '#fff';
document.body.appendChild(bootBadge);

// --- Styles ---
const defaultStyle = new Style({
  fill: new Fill({ color: 'rgba(134, 182, 198, 0.25)' }),
  stroke: new Stroke({ color: '#86b6c6', width: 1.5 }),
});

const hoverStyle = new Style({
  fill: new Fill({ color: 'rgba(134, 182, 198, 0.55)' }),
  stroke: new Stroke({ color: '#fff', width: 2.5 }),
});

const edgeHoverStyle = new Style({
  fill: new Fill({ color: 'rgba(134, 182, 198, 0.25)' }),
  stroke: new Stroke({ color: '#ffd166', width: 4 }),
});

const edgeSegmentHoverStyle = new Style({
  stroke: new Stroke({
    color: '#ffd166',
    width: 5,
  }),
});

function closestPolygonSegment(
  polygon: Polygon,
  coordinate: [number, number],
  map: OlMap,
): { i: number; a: [number, number]; b: [number, number]; closest: [number, number]; distPx: number } | null {
  const ring = polygon.getCoordinates()[0] as [number, number][];
  if (!ring || ring.length < 2) return null;

  const pPixel = map.getPixelFromCoordinate(coordinate);
  let best:
    | {
        i: number;
        closest: [number, number];
        distPx: number;
      }
    | undefined;

  for (let i = 0; i < ring.length - 1; i++) {
    const seg = new LineString([ring[i], ring[i + 1]]);
    const closest = seg.getClosestPoint(coordinate) as [number, number];
    const cPixel = map.getPixelFromCoordinate(closest);
    const dx = pPixel[0] - cPixel[0];
    const dy = pPixel[1] - cPixel[1];
    const distPx = Math.hypot(dx, dy);
    if (!best || distPx < best.distPx) best = { i, closest, distPx };
  }

  if (!best) return null;
  return {
    i: best.i,
    a: ring[best.i],
    b: ring[best.i + 1],
    closest: best.closest,
    distPx: best.distPx,
  };
}

function featureUid(feature: Feature): number {
  // OpenLayers assigns an internal uid we can use as a stable key.
  return (feature as any).ol_uid as number;
}

// --- Sample features ---
const polyFromLonLat = (ringLonLat: [number, number][]) =>
  new Polygon([ringLonLat.map((c) => fromLonLat(c))]);

const features = [
  new Feature({
    // Near Oslo (on land)
    geometry: polyFromLonLat([
      [10.60, 59.88],
      [10.80, 59.88],
      [10.80, 60.00],
      [10.60, 60.00],
      [10.60, 59.88],
    ]),
    name: 'Zone A',
    type: 'Residential',
  }),
  new Feature({
    geometry: polyFromLonLat([
      [10.85, 59.86],
      [11.10, 59.86],
      [11.10, 59.98],
      [10.85, 59.98],
      [10.85, 59.86],
    ]),
    name: 'Zone B',
    type: 'Commercial',
  }),
  new Feature({
    geometry: new Point(fromLonLat([10.75, 59.93])),
    name: 'Point of Interest',
    type: 'POI',
  }),
];

const poiStyle = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: '#86b6c6' }),
    stroke: new Stroke({ color: '#fff', width: 2 }),
  }),
});

const poiHoverStyle = new Style({
  image: new CircleStyle({
    radius: 11,
    fill: new Fill({ color: '#fff' }),
    stroke: new Stroke({ color: '#105167', width: 2.5 }),
  }),
});

features[2].setStyle(poiStyle);

const vectorLayer = new VectorLayer({
  source: new VectorSource({ features }),
  style: defaultStyle,
});

const vectorSource = vectorLayer.getSource();
if (!vectorSource) throw new Error('Missing vector source');

// Vertex selection state: per-feature set of selected vertex indices.
const selectedVerticesByFeature = new Map<number, Set<number>>();
const clearSelectedVertices = (feature?: Feature) => {
  if (!feature) {
    selectedVerticesByFeature.clear();
    return;
  }
  selectedVerticesByFeature.delete(featureUid(feature));
};

// Edge-follow "handle" layer (drawn above everything).
const edgeHandleFeature = new Feature({ geometry: undefined as unknown as Point });
const edgeHandleSource = new VectorSource({ features: [edgeHandleFeature] });
const edgeHandleLayer = new VectorLayer({
  source: edgeHandleSource,
  style: new Style({
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: '#ffd166' }),
      stroke: new Stroke({ color: '#105167', width: 2 }),
    }),
  }),
});
(edgeHandleLayer as any).setZIndex?.(999);

// Vertex handles for hovered polygons.
const vertexHandleSource = new VectorSource();
const vertexHandleStyleDefault = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: '#ffffff' }),
    stroke: new Stroke({ color: '#ffd166', width: 4 }),
  }),
});
const vertexHandleStyleSelected = new Style({
  image: new CircleStyle({
    radius: 9,
    fill: new Fill({ color: '#ffd166' }),
    stroke: new Stroke({ color: '#0f2430', width: 4 }),
  }),
});
const vertexHandleLayer = new VectorLayer({
  source: vertexHandleSource,
  style: (f) => ((f as Feature).get('selected') ? vertexHandleStyleSelected : vertexHandleStyleDefault),
});
(vertexHandleLayer as any).setZIndex?.(998);

const map = new OlMap({
  target: 'map',
  layers: [new TileLayer({ source: new OSM() }), vectorLayer, vertexHandleLayer, edgeHandleLayer],
  view: new View({
    center: fromLonLat([10.75, 59.93]),
    zoom: 11,
  }),
});

function primaryFeatureAtPixel(pixel: number[]) {
  return map.forEachFeatureAtPixel(
    pixel,
    (f) => f,
    // Avoid flicker by ignoring overlay/handle layers in hit-testing.
    { layerFilter: (layer) => layer === vectorLayer },
  ) as Feature | undefined;
}

// --- Context menu (right click) for vertex deletion ---
const contextMenu = document.createElement('div');
contextMenu.style.position = 'fixed';
contextMenu.style.zIndex = '10000';
contextMenu.style.minWidth = '180px';
contextMenu.style.background = '#0f2430';
contextMenu.style.border = '1px solid rgba(134, 182, 198, 0.65)';
contextMenu.style.borderRadius = '8px';
contextMenu.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
contextMenu.style.padding = '6px';
contextMenu.style.display = 'none';

const contextMenuItem = document.createElement('button');
contextMenuItem.type = 'button';
contextMenuItem.textContent = 'Delete node/vertex';
contextMenuItem.style.width = '100%';
contextMenuItem.style.display = 'block';
contextMenuItem.style.padding = '8px 10px';
contextMenuItem.style.border = '0';
contextMenuItem.style.borderRadius = '6px';
contextMenuItem.style.background = 'transparent';
contextMenuItem.style.color = '#fff';
contextMenuItem.style.font = '12px/1.2 monospace';
contextMenuItem.style.textAlign = 'left';
contextMenuItem.style.cursor = 'pointer';

contextMenuItem.addEventListener('mouseenter', () => {
  contextMenuItem.style.background = 'rgba(134, 182, 198, 0.18)';
});
contextMenuItem.addEventListener('mouseleave', () => {
  contextMenuItem.style.background = 'transparent';
});

contextMenu.appendChild(contextMenuItem);
document.body.appendChild(contextMenu);

let contextTarget:
  | {
      feature: Feature;
      vertexIndex: number;
    }
  | null = null;

function hideContextMenu() {
  contextMenu.style.display = 'none';
  contextTarget = null;
}

document.addEventListener('click', () => hideContextMenu(), { capture: true });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideContextMenu();
});

contextMenuItem.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!contextTarget) return;

  const geom = contextTarget.feature.getGeometry();
  if (!geom || geom.getType() !== 'Polygon') return;
  const polygon = geom as Polygon;
  const rings = polygon.getCoordinates() as [number, number][][];
  const ring = rings[0];

  // Need at least 3 distinct vertices (plus closing point).
  const distinctVertexCount = Math.max(0, ring.length - 1);
  if (distinctVertexCount <= 3) {
    hideContextMenu();
    return;
  }

  ring.splice(contextTarget.vertexIndex, 1);
  ring[ring.length - 1] = ring[0]; // keep closed
  polygon.setCoordinates([ring]);

  // Indices have shifted; safest is to clear selection for this feature.
  clearSelectedVertices(contextTarget.feature);

  hideContextMenu();
});

map.getViewport().addEventListener('contextmenu', (e) => {
  e.preventDefault();

  const rect = map.getViewport().getBoundingClientRect();
  const clientX = (e as MouseEvent).clientX;
  const clientY = (e as MouseEvent).clientY;
  const pixel = map.getEventPixel(e);

  const feature = primaryFeatureAtPixel(pixel);
  if (!feature) return hideContextMenu();
  if (feature.get('type') === 'POI') return hideContextMenu();

  const geom = feature.getGeometry();
  if (!geom || geom.getType() !== 'Polygon') return hideContextMenu();
  const polygon = geom as Polygon;
  const ring = polygon.getCoordinates()[0] as [number, number][];
  if (!ring || ring.length < 4) return hideContextMenu();

  // Find closest vertex (excluding duplicate closing vertex).
  const VERTEX_HIT_PX = 16;
  let bestIdx = -1;
  let bestDistPx = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const vPx = map.getPixelFromCoordinate(ring[i]);
    const dx = vPx[0] - pixel[0];
    const dy = vPx[1] - pixel[1];
    const d = Math.hypot(dx, dy);
    if (d < bestDistPx) {
      bestDistPx = d;
      bestIdx = i;
    }
  }

  if (bestIdx === -1 || bestDistPx > VERTEX_HIT_PX) return hideContextMenu();

  contextTarget = { feature, vertexIndex: bestIdx };
  contextMenu.style.left = `${Math.min(clientX, rect.right - 10)}px`;
  contextMenu.style.top = `${Math.min(clientY, rect.bottom - 10)}px`;
  contextMenu.style.display = 'block';
});

// Click an edge to insert a vertex.
const modify = new Modify({
  source: vectorSource,
  // Makes vertex handles much easier to pick/drag.
  pixelTolerance: 28,
  // Prevent Shift+click (and other gestures) from deleting vertices.
  // Deletion is handled via the right-click context menu instead.
  deleteCondition: () => false,
  insertVertexCondition: (evt) => {
    if (!singleClick(evt)) return false;
    const feature = primaryFeatureAtPixel(evt.pixel);
    if (!feature) return false;
    if (feature.get('type') === 'POI') return false;
    const geom = feature.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return false;

    const EDGE_HIT_PX = 12;
    const seg = closestPolygonSegment(geom as Polygon, evt.coordinate as any, map);
    return !!seg && seg.distPx <= EDGE_HIT_PX;
  },
});
map.addInteraction(modify);
modify.on('modifyend', (e: any) => {
  // When vertices move/insert/delete via Modify, clear selection to avoid index drift.
  const modified = e?.features?.getArray?.() as Feature[] | undefined;
  if (!modified) return;
  for (const f of modified) clearSelectedVertices(f);
});

// Drag polygons to move them as a whole.
const translate = new Translate({
  features: vectorSource.getFeaturesCollection() ?? undefined,
  filter: (feature) => feature.getGeometry()?.getType?.() === 'Polygon',
  // Don't let polygon-drag steal events when user is trying to grab a vertex.
  condition: (evt) => {
    const originalEvent = (evt as any).originalEvent as MouseEvent | PointerEvent | undefined;
    const pixel = originalEvent ? map.getEventPixel(originalEvent) : ((evt as any).pixel as number[] | undefined);
    if (!pixel) return true;
    const feature = primaryFeatureAtPixel(pixel);
    if (!feature) return false;
    const geom = feature.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return false;
    const ring = (geom as Polygon).getCoordinates()[0] as [number, number][];
    const VERTEX_HIT_PX = 20;
    for (let i = 0; i < ring.length - 1; i++) {
      const vPx = map.getPixelFromCoordinate(ring[i]);
      const dx = vPx[0] - pixel[0];
      const dy = vPx[1] - pixel[1];
      if (Math.hypot(dx, dy) <= VERTEX_HIT_PX) return false;
    }
    return true;
  },
});
map.addInteraction(translate);

// Deterministic vertex insertion: click near an edge segment to insert a vertex
// exactly into that segment (between its two vertices).
(map as any).on('singleclick', (evt: MapBrowserEvent<PointerEvent>) => {
  // Shift+click toggles vertex selection (and changes handle styling).
  const originalEvent = (evt as any).originalEvent as MouseEvent | undefined;
  const isShift = !!originalEvent?.shiftKey;
  if (isShift) {
    const feature = primaryFeatureAtPixel(evt.pixel);
    if (!feature || feature.get('type') === 'POI') return;
    const geom = feature.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return;

    const polygon = geom as Polygon;
    const ring = polygon.getCoordinates()[0] as [number, number][];

    const VERTEX_HIT_PX = 20;
    let bestIdx = -1;
    let bestDistPx = Infinity;
    for (let i = 0; i < ring.length - 1; i++) {
      const vPx = map.getPixelFromCoordinate(ring[i]);
      const dx = vPx[0] - evt.pixel[0];
      const dy = vPx[1] - evt.pixel[1];
      const d = Math.hypot(dx, dy);
      if (d < bestDistPx) {
        bestDistPx = d;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1 && bestDistPx <= VERTEX_HIT_PX) {
      const uid = featureUid(feature);
      const set = selectedVerticesByFeature.get(uid) ?? new Set<number>();
      if (set.has(bestIdx)) set.delete(bestIdx);
      else set.add(bestIdx);
      if (set.size) selectedVerticesByFeature.set(uid, set);
      else selectedVerticesByFeature.delete(uid);
    }

    // Prevent other click behaviors (like inserting vertices) when shift is held.
    return;
  }

  const feature = primaryFeatureAtPixel(evt.pixel);
  if (!feature) return;
  if (feature.get('type') === 'POI') return;

  const geom = feature.getGeometry();
  if (!geom || geom.getType() !== 'Polygon') return;

  const polygon = geom as Polygon;
  const seg = closestPolygonSegment(polygon, evt.coordinate as any, map);
  const EDGE_HIT_PX = 12;
  if (!seg || seg.distPx > EDGE_HIT_PX) return;

  const rings = polygon.getCoordinates() as [number, number][][];
  const ring = rings[0];

  // Avoid inserting essentially on top of an existing vertex.
  const pPixel = map.getPixelFromCoordinate(evt.coordinate);
  const aPixel = map.getPixelFromCoordinate(seg.a);
  const bPixel = map.getPixelFromCoordinate(seg.b);
  const distA = Math.hypot(pPixel[0] - aPixel[0], pPixel[1] - aPixel[1]);
  const distB = Math.hypot(pPixel[0] - bPixel[0], pPixel[1] - bPixel[1]);
  const VERTEX_SNAP_PX = 6;
  if (distA <= VERTEX_SNAP_PX || distB <= VERTEX_SNAP_PX) return;

  // Insert new vertex between ring[i] and ring[i+1].
  ring.splice(seg.i + 1, 0, seg.closest);

  // Keep ring closed (last = first).
  ring[ring.length - 1] = ring[0];
  polygon.setCoordinates([ring]);

  // Indices shifted; clear selection for this feature.
  clearSelectedVertices(feature);
});

// --- Hover logic ---
let hoveredFeature: Feature | null = null;
const tooltip = document.getElementById('tooltip');
if (!tooltip) throw new Error('Missing #tooltip element');

(map as any).on('pointermove', (evt: MapBrowserEvent<PointerEvent>) => {
  if ((evt as any).dragging) return;

  const pixel = evt.pixel;
  const feature = primaryFeatureAtPixel(pixel);

  if (hoveredFeature && hoveredFeature !== feature) {
    if (hoveredFeature.get('type') !== 'POI') hoveredFeature.setStyle(undefined);
    else hoveredFeature.setStyle(poiStyle);
    hoveredFeature = null;
    tooltip.style.display = 'none';
  }

  if (feature) {
    if (feature.get('type') === 'POI') {
      feature.setStyle(poiHoverStyle);
      edgeHandleFeature.setGeometry(undefined);
      vertexHandleSource.clear();
    } else {
      const geom = feature.getGeometry();
      const isPolygon = geom?.getType?.() === 'Polygon';

      if (isPolygon) {
        const polygon = geom as Polygon;
        const ring = polygon.getCoordinates()[0] as [number, number][];

        // Cursor hint when close to a vertex (easier to "feel" the grab zone).
        let nearVertex = false;
        const VERTEX_HIT_PX = 20;
        for (let i = 0; i < ring.length - 1; i++) {
          const vPx = map.getPixelFromCoordinate(ring[i]);
          const dx = vPx[0] - pixel[0];
          const dy = vPx[1] - pixel[1];
          if (Math.hypot(dx, dy) <= VERTEX_HIT_PX) {
            nearVertex = true;
            break;
          }
        }

        const EDGE_HIT_PX = 12;
        const seg = closestPolygonSegment(polygon, evt.coordinate as any, map);
        if (seg && seg.distPx <= EDGE_HIT_PX) {
          edgeSegmentHoverStyle.setGeometry(new LineString([seg.a, seg.b]));
          feature.setStyle([hoverStyle, edgeSegmentHoverStyle]);
          edgeHandleFeature.setGeometry(new Point(seg.closest));
        } else {
          feature.setStyle(hoverStyle);
          edgeHandleFeature.setGeometry(undefined);
        }

        // Show vertex handles for the hovered polygon.
        vertexHandleSource.clear();
        // Skip the closing coordinate (same as first).
        const selected = selectedVerticesByFeature.get(featureUid(feature));
        for (let i = 0; i < Math.max(0, ring.length - 1); i++) {
          const vf = new Feature(new Point(ring[i]));
          vf.set('selected', !!selected?.has(i));
          vertexHandleSource.addFeature(vf);
        }

        const nearEdge = !!seg && seg.distPx <= EDGE_HIT_PX;
        // 4-arrow cursor on vertex drag; plus-style cursor on edge add
        map.getTargetElement().style.cursor = nearVertex ? 'move' : nearEdge ? 'copy' : 'pointer';
      } else {
        feature.setStyle(hoverStyle);
        edgeHandleFeature.setGeometry(undefined);
        vertexHandleSource.clear();
        map.getTargetElement().style.cursor = 'pointer';
      }
    }

    hoveredFeature = feature;

    tooltip.style.display = 'block';
    tooltip.style.left = `${pixel[0] + 14}px`;
    tooltip.style.top = `${pixel[1] - 10}px`;
    tooltip.textContent = `${feature.get('name')} · ${feature.get('type')}`;

  } else {
    map.getTargetElement().style.cursor = '';
    edgeHandleFeature.setGeometry(undefined);
    vertexHandleSource.clear();
  }
});

map.getTargetElement().addEventListener('mouseleave', () => {
  if (hoveredFeature) {
    if (hoveredFeature.get('type') !== 'POI') hoveredFeature.setStyle(undefined);
    else hoveredFeature.setStyle(poiStyle);
    hoveredFeature = null;
  }
  tooltip.style.display = 'none';
  map.getTargetElement().style.cursor = '';
  edgeHandleFeature.setGeometry(undefined);
  vertexHandleSource.clear();
});

export {};
