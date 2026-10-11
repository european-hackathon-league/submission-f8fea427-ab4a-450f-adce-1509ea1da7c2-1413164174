import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VehicleViewer from './VehicleViewer.jsx';
import { loadFrames } from './vehicleFrames.js';
vi.mock('./vehicleFrames.js', async original => ({ ...await original(), loadFrames: vi.fn() }));
let frame;
beforeEach(() => {
  loadFrames.mockReset().mockImplementation(async () => ({ get: async () => ({ width: 2560, height: 1440 }), close() {} }));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect() {}, drawImage() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 400 });
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', callback => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { cleanup(); delete HTMLDialogElement.prototype.showModal; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('renders at display density and replaces the exterior when a different trim is picked', async () => {
  const user = userEvent.setup();
  const { container } = render(<VehicleViewer initial="F70-116" onClose={() => {}} />);
  await act(async () => {});
  await act(async () => { frame(); });
  const canvas = container.querySelector('canvas');
  expect(canvas.width).toBe(2000); expect(canvas.height).toBe(800);
  expect(canvas).toHaveAttribute('data-source-width', '2560');
  expect(canvas).toHaveAttribute('data-model', 'F70-116');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'F70-M135-xDrive');
  await act(async () => {}); await act(async () => { frame(); });
  expect(canvas).toHaveAttribute('data-model', 'F70-M135-xDrive');
  expect(loadFrames).toHaveBeenLastCalledWith('21GE', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it('zooms without fetching frames again and resets zoom when changing models', async () => {
 const user=userEvent.setup();
 const draw=vi.fn(); HTMLCanvasElement.prototype.getContext.mockReturnValue({clearRect(){},drawImage:draw});
 const {container}=render(<VehicleViewer initial="F70-116" onClose={()=>{}}/>);
 await act(async()=>{}); await act(async()=>frame());
 const width=draw.mock.lastCall[3], canvas=container.querySelector('canvas');
 expect(screen.queryByRole('button',{name:'Previous angle'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Next angle'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByRole('slider',{name:'Exterior angle'}),{target:{value:'90'}});
 await act(async()=>frame());
 expect(canvas).toHaveAttribute('data-angle','90');
 fireEvent.change(screen.getByRole('slider',{name:'Exterior zoom'}),{target:{value:'125'}}); await act(async()=>frame());
 expect(draw.mock.lastCall[3]).toBeGreaterThan(width);
 expect(screen.getByRole('slider',{name:'Exterior zoom'})).toHaveValue('125');
 const zoomed=draw.mock.lastCall[3];
 fireEvent.wheel(canvas,{deltaY:-100}); await act(async()=>frame());
 expect(draw.mock.lastCall[3]).toBeGreaterThan(zoomed);
 await user.click(screen.getByRole('button',{name:'Reset view'})); await act(async()=>frame());
 expect(draw.mock.lastCall[3]).toBe(width);
 expect(screen.getByRole('slider',{name:'Exterior zoom'})).toHaveValue('100');
 fireEvent.change(screen.getByRole('slider',{name:'Exterior zoom'}),{target:{value:'125'}});
 await user.selectOptions(screen.getByRole('combobox',{name:'Model'}),'F70-120');
 await act(async()=>{}); await act(async()=>frame());
 expect(draw.mock.lastCall[3]).toBe(width);
 expect(loadFrames).toHaveBeenCalledTimes(2);
});

it('fills the viewer with the car instead of fitting the padded source image', async () => {
 const draw=vi.fn(); HTMLCanvasElement.prototype.getContext.mockReturnValue({clearRect(){},drawImage:draw});
 const {container}=render(<VehicleViewer initial="F70-116" onClose={()=>{}}/>);
 await act(async()=>{}); await act(async()=>frame());
 const [,x,y,width,height]=draw.mock.lastCall, canvas=container.querySelector('canvas');
 // Studio cars occupy up to 80% of the source width; keep them large without distortion.
 expect(width*.8).toBeGreaterThanOrEqual(canvas.width*.9);
 expect(width/height).toBeCloseTo(2560/1440);
 expect(x).toBeLessThan(0);
 expect(y).toBeLessThan(0);
 expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%');
});
