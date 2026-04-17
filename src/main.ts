import 'ol/ol.css';
import Feature from 'ol/Feature';
import Map from 'ol/Map';
import View from 'ol/View';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import OSM from 'ol/source/OSM';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import type MapBrowserEvent from 'ol/MapBrowserEvent';

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

// --- Sample features ---
const features = [
  new Feature({
    geometry: new Polygon([
      [
        [1250000, 7600000],
        [1270000, 7600000],
        [1270000, 7620000],
        [1250000, 7620000],
        [1250000, 7600000],
      ],
    ]),
    name: 'Zone A',
    type: 'Residential',
  }),
  new Feature({
    geometry: new Polygon([
      [
        [1280000, 7600000],
        [1310000, 7600000],
        [1310000, 7625000],
        [1280000, 7625000],
        [1280000, 7600000],
      ],
    ]),
    name: 'Zone B',
    type: 'Commercial',
  }),
  new Feature({
    geometry: new Point([1260000, 7640000]),
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

const map = new Map({
  target: 'map',
  layers: [new TileLayer({ source: new OSM() }), vectorLayer],
  view: new View({
    center: [1280000, 7615000],
    zoom: 10,
  }),
});

// --- Hover logic ---
let hoveredFeature: Feature | null = null;
const tooltip = document.getElementById('tooltip');
if (!tooltip) throw new Error('Missing #tooltip element');

(map as any).on('pointermove', (evt: MapBrowserEvent<PointerEvent>) => {
  if ((evt as any).dragging) return;

  const pixel = evt.pixel;
  const feature = map.forEachFeatureAtPixel(pixel, (f) => f) as Feature | undefined;

  if (hoveredFeature && hoveredFeature !== feature) {
    if (hoveredFeature.get('type') !== 'POI') hoveredFeature.setStyle(undefined);
    else hoveredFeature.setStyle(poiStyle);
    hoveredFeature = null;
    tooltip.style.display = 'none';
  }

  if (feature) {
    if (feature.get('type') !== 'POI') feature.setStyle(hoverStyle);
    else feature.setStyle(poiHoverStyle);

    hoveredFeature = feature;

    tooltip.style.display = 'block';
    tooltip.style.left = `${pixel[0] + 14}px`;
    tooltip.style.top = `${pixel[1] - 10}px`;
    tooltip.textContent = `${feature.get('name')} · ${feature.get('type')}`;

    map.getTargetElement().style.cursor = 'pointer';
  } else {
    map.getTargetElement().style.cursor = '';
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
});

export {};
