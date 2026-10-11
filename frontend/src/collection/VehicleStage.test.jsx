import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VehicleStage from './VehicleStage.jsx';
import { loadFrames } from './vehicleFrames.js';

vi.mock('./vehicleFrames.js', async importOriginal => ({ ...await importOriginal(), loadFrames: vi.fn() }));
const sequence = () => ({ get: async () => ({ width: 2560, height: 1440 }), close: vi.fn(), detach: vi.fn() });
const selections = { F70: 'F70-116', G60: 'G60-520i', G68: 'G68-5-Series-Long-Wheelbase', G70: 'G70-740-xDrive' };
let frame;
beforeEach(() => {
  loadFrames.mockReset().mockImplementation(async asset => asset === '31GE' ? sequence() : new Promise(() => {}));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ setTransform() {}, clearRect() {}, drawImage() {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', callback => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const paint = () => act(async () => { frame(16); });

it('shows the selected family poster while its rotation sequence is still loading', async () => {
  render(<VehicleStage progress={{ current: 3 }} active={3} />);
  await act(async () => {}); await paint();
  expect(screen.getByRole('img', { name: 'BMW 740 xDrive' })).toBeVisible();
  expect(screen.getByRole('img', { name: 'BMW 740 xDrive' })).toHaveAttribute('src', '/images/bmw/exterior/61HZ/04.webp');
});

it('keeps the canvas visible across every loaded family handoff without flashing a different-sized poster', async () => {
  loadFrames.mockImplementation(async () => sequence());
  const progress = { current: .74 };
  const { rerender, container } = render(<VehicleStage progress={progress} active={0} />);
  await act(async () => {}); await paint();
  expect(container.querySelector('.j-scene-poster')).toBeNull();
  for (const [active, position] of [[1, .76], [2, 1.76], [3, 2.76], [2, 2.74], [1, 1.74], [0, .74]]) {
    progress.current = position;
    rerender(<VehicleStage progress={progress} active={active} />);
    // Parent commits active before the stage's next animation frame.
    expect(container.querySelector('.j-scene-poster')).toBeNull();
    expect(container.querySelector('canvas')).toBeVisible();
    await paint();
    expect(container.querySelector('.j-scene-poster')).toBeNull();
  }
});

it('ignores an older trim request that finishes after a newer selection', async () => {
  let finishOld;
  const late = sequence();
  loadFrames.mockImplementation(asset => asset === '21GE' ? new Promise(resolve => { finishOld = () => resolve(late); }) : Promise.resolve(sequence()));
  const progress = { current: 0 };
  const { rerender, container } = render(<VehicleStage progress={progress} selections={selections} />);
  await act(async () => {}); await paint();
  rerender(<VehicleStage progress={progress} selections={{ ...selections, F70: 'F70-M135-xDrive' }} />);
  await act(async () => {});
  rerender(<VehicleStage progress={progress} selections={{ ...selections, F70: 'F70-120' }} />);
  await act(async () => {}); await paint();
  expect(container.querySelector('canvas')).toHaveAttribute('data-model', 'F70-120');
  await act(async () => { finishOld(); }); await paint();
  expect(container.querySelector('canvas')).toHaveAttribute('data-model', 'F70-120');
  expect(late.close).toHaveBeenCalledOnce();
});

it('loads the chosen trim while retaining other families and the visible canvas', async () => {
  loadFrames.mockImplementation(async () => sequence());
  const progress = { current: 0 };
  const { rerender, container } = render(<VehicleStage progress={progress} selections={selections} />);
  await act(async () => {}); await paint();
  expect(container.querySelector('canvas')).toHaveAttribute('data-model', 'F70-116');
  rerender(<VehicleStage progress={progress} selections={{ ...selections, F70: 'F70-M135-xDrive' }} />);
  expect(container.querySelector('.j-scene-poster')).toBeNull();
  await act(async () => {}); await paint();
  expect(loadFrames).toHaveBeenCalledTimes(5);
  expect(container.querySelector('canvas')).toHaveAttribute('data-model', 'F70-M135-xDrive');
});

it('reloads the affected sequence when retrying a decoding failure', async () => {
  const broken = sequence();
  broken.get = vi.fn().mockResolvedValueOnce({ width: 2560, height: 1440 }).mockRejectedValue(new Error('Decode failed'));
  loadFrames.mockImplementation(async () => sequence()).mockImplementationOnce(async () => broken);
  const { container } = render(<VehicleStage progress={{ current: 0 }} />);
  await act(async () => {}); await paint();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await act(async () => {}); await paint();
  expect(loadFrames).toHaveBeenCalledTimes(5);
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  expect(container.querySelector('canvas')).toBeVisible();
});

it('discards an in-flight crossfade when one of its model sequences is replaced', async () => {
  let finishAngle, reads = 0;
  const oldImage = { width: 2560, height: 1440, closed: false };
  loadFrames.mockImplementation(async asset => asset === '31GE'
    ? { get: async () => oldImage, close() { oldImage.closed = true; }, detach() {} }
    : asset === '11FJ'
      ? { get: () => ++reads === 2 ? new Promise(resolve => { finishAngle = resolve; }) : Promise.resolve({ width: 2560, height: 1440 }), close() {}, detach() {} }
      : sequence());
  HTMLCanvasElement.prototype.getContext.mockReturnValue({ setTransform() {}, clearRect() {}, drawImage(image) { if (image.closed) throw new Error('Closed bitmap'); } });
  const progress = { current: .74 };
  const { rerender } = render(<VehicleStage progress={progress} selections={selections} />);
  await act(async () => {});
  act(() => { frame(); });
  rerender(<VehicleStage progress={progress} selections={{ ...selections, F70: 'F70-M135-xDrive' }} />);
  await act(async () => {});
  await act(async () => { finishAngle({ width: 2560, height: 1440 }); });
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});

it('keeps the car ground anchor fixed across G60 and G68 image aspect ratios', async () => {
 const draw=vi.fn();
 HTMLCanvasElement.prototype.getContext.mockReturnValue({setTransform(){},clearRect(){},drawImage:draw});
 vi.spyOn(HTMLCanvasElement.prototype,'getBoundingClientRect').mockReturnValue({width:1200,height:900});
 loadFrames.mockImplementation(async asset=>({...sequence(),get:async()=>asset==='g68'?{width:1200,height:500}:{width:2560,height:1440}}));
 const progress={current:1}; render(<VehicleStage progress={progress} selections={selections}/>);
 await act(async()=>{}); await paint();
 const g60=draw.mock.lastCall;
 progress.current=2; await paint(); const g68=draw.mock.lastCall;
 expect(g68[2]+g68[4]*.85).toBeCloseTo(g60[2]+g60[4]*.80,5);
});

it('continues crossfading while a new angle is decoding', async () => {
 const draw=vi.fn(),image={width:2560,height:1440};
 HTMLCanvasElement.prototype.getContext.mockReturnValue({setTransform(){},clearRect(){},drawImage:draw});
 loadFrames.mockImplementation(async()=>({...sequence(),peek:(_index,nearest)=>nearest?image:undefined,get:vi.fn().mockResolvedValueOnce(image).mockImplementation(()=>new Promise(()=>{}))}));
 const progress={current:1.7}; render(<VehicleStage progress={progress} selections={selections}/>);
 await act(async()=>{}); await paint();
 expect(draw).toHaveBeenCalledTimes(2);
 progress.current=1.8; await paint();
 expect(draw).toHaveBeenCalledTimes(4);
});
