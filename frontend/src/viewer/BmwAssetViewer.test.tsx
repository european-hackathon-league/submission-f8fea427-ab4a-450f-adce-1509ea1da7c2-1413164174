import {act,cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import BmwAssetViewer, {BMW_I5_MODEL_UID,frameCameraForAspect,normalizeSketchfabNodeMap} from './BmwAssetViewer';
import {findings as apiFindings} from '../api/fixtures';
const findings=apiFindings.flatMap(f=>f.part_ids.map(id=>({id,counts:f.counts})));

type InitOptions={success:(api:any)=>void;error:()=>void};

afterEach(()=>cleanup());

describe('normalizeSketchfabNodeMap',()=>{
  it('accepts documented flattened nodes and object-wrapped node maps',()=>{
    expect(normalizeSketchfabNodeMap([{instanceID:7,name:'Headlamps'}])).toEqual([{instanceID:7,name:'Headlamps'}]);
    expect(normalizeSketchfabNodeMap({nodes:{'8':{name:'Dashboard'}}})).toEqual([{instanceID:8,name:'Dashboard'}]);
    expect(normalizeSketchfabNodeMap({bad:{name:'No instance id'}})).toEqual([]);
  });
});

describe('aspect-aware camera framing',()=>{
  it('pulls back for narrow stages while preserving target and Z-up viewing direction',()=>{
    const camera={position:[5,3,8],target:[1,-2,2]};
    const framed=frameCameraForAspect(camera,573/450);
    const originalDirection=camera.position.map((value,index)=>value-camera.target[index]);
    const framedDirection=framed.position.map((value,index)=>value-framed.target[index]);

    expect(framed.target).toEqual(camera.target);
    expect(framed.position[2]-framed.target[2]).toBeGreaterThan(originalDirection[2]);
    expect(framedDirection[0]/originalDirection[0]).toBeCloseTo(framedDirection[1]/originalDirection[1]);
    expect(framedDirection[2]/originalDirection[2]).toBeCloseTo(framedDirection[0]/originalDirection[0]);
    expect(frameCameraForAspect(camera,16/9)).toEqual(camera);
  });
});

describe('BmwAssetViewer', () => {
  it('keeps selected component inside the active view when switching presets',()=>{
    const onSelectComponent=vi.fn();
    const onViewChange=vi.fn();
    render(<BmwAssetViewer selectedComponent="body" onSelectComponent={onSelectComponent} view="exterior" onViewChange={onViewChange} heatmap={false} findings={findings}/>);

    fireEvent.click(screen.getByRole('button',{name:'Interior photo'}));

    expect(onViewChange).toHaveBeenCalledWith('interior');
    expect(onSelectComponent).toHaveBeenCalledWith('steering');
  });

  it('shows real-asset attribution and keeps parent-controlled component selection usable', () => {
    const onSelectComponent=vi.fn();
    const props={onSelectComponent,view:'exterior' as const,onViewChange:vi.fn(),heatmap:true,findings,className:'bmw-asset-viewer--compact'};
    const {rerender}=render(<BmwAssetViewer {...props} selectedComponent="body"/>);

    expect(screen.getByRole('region',{name:'BMW i5 M60 vehicle viewer'})).toHaveClass('bmw-asset-viewer--compact');
    expect(screen.getByRole('link',{name:/Nazh Design/})).toHaveAttribute('href',expect.stringContaining('sketchfab.com'));
    expect(screen.getByRole('link',{name:/CC BY 4.0/})).toHaveAttribute('href','https://creativecommons.org/licenses/by/4.0/');
    expect(screen.getByRole('button',{name:/Headlamps/}).querySelector('.bmw-asset-viewer__part-dot')).toHaveStyle({'--heat':'#8a909b'});
    fireEvent.click(screen.getByRole('button',{name:/Headlamps/}));
    expect(onSelectComponent).toHaveBeenCalledWith('lighting');
    rerender(<BmwAssetViewer {...props} selectedComponent="lighting"/>);
    expect(screen.getByRole('button',{name:/Headlamps/})).toHaveAttribute('aria-pressed','true');
  });

  it('uses a licensed real G60 cabin photograph instead of claiming an unverified 3D interior', () => {
    const onSelectComponent=vi.fn();
    const {container}=render(<BmwAssetViewer selectedComponent="dashboard" onSelectComponent={onSelectComponent} view="interior" onViewChange={vi.fn()} heatmap findings={findings}/>);

    expect(screen.getByRole('img',{name:/BMW 5 Series G60 cabin reference photo/i})).toHaveAttribute('src','/vehicles/g60-interior.jpg');
    expect(container.querySelector('.bmw-asset-viewer__photo-canvas')).toContainElement(container.querySelector('.bmw-asset-viewer__photo-markers'));
    expect(screen.getByText(/Detailed 3D cabin not verified/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/Dashboard feedback marker/}));
    expect(onSelectComponent).toHaveBeenCalledWith('dashboard');
  });

  it('maps a real Sketchfab node click to component selection after viewer readiness', async () => {
    const onSelectComponent=vi.fn();
    const onStatusChange=vi.fn();
    const events:Record<string,(value?:any)=>void>={};
    const api={
      start:vi.fn(),stop:vi.fn(),
      addEventListener:vi.fn((name:string,callback:(value?:any)=>void)=>{events[name]=callback;}),
      getCameraLookAt:(callback:(error:unknown,camera:any)=>void)=>callback(null,{position:[2,2,4],target:[0,0,0]}),
      getNodeMap:(callback:(error:unknown,nodes:unknown)=>void)=>callback(null,{nodes:{front:{instanceID:77,name:'headlamps'},wheel:{instanceID:78,name:'steering_wheel'}}}),
      setCameraLookAt:vi.fn(),setBackground:vi.fn(),recenterCamera:vi.fn(),
    };
    const init=vi.fn();
    class SketchfabMock { init(uid:string,options:InitOptions){init(uid,options);options.success(api);} }
    Object.assign(window,{Sketchfab:SketchfabMock});
    render(<BmwAssetViewer selectedComponent="body" onSelectComponent={onSelectComponent} view="exterior" onViewChange={vi.fn()} heatmap={false} findings={findings} onStatusChange={onStatusChange}/>);

    await waitFor(()=>expect(init).toHaveBeenCalledWith(BMW_I5_MODEL_UID,expect.objectContaining({autospin:0,dnt:1})));
    expect(events.viewerready).toBeTypeOf('function');
    act(()=>events.viewerready());
    await waitFor(()=>expect(onStatusChange).toHaveBeenCalledWith('ready'));
    expect(api.setBackground).toHaveBeenCalledWith({color:[0.15,0.16,0.18]});
    events.click({instanceID:77});
    expect(onSelectComponent).toHaveBeenCalledWith('lighting');
    events.click({instanceID:78});
    expect(onSelectComponent).toHaveBeenCalledTimes(1);
  });

  it('reinitializes the hosted model after switching away from and back to exterior', async () => {
    const events:Record<string,(value?:any)=>void>={};
    const api={
      start:vi.fn(),stop:vi.fn(),addEventListener:vi.fn((name:string,callback:(value?:any)=>void)=>{events[name]=callback;}),
      getCameraLookAt:(callback:(error:unknown,camera:any)=>void)=>callback(null,{position:[2,2,4],target:[0,0,0]}),
      getNodeMap:(callback:(error:unknown,nodes:unknown)=>void)=>callback(null,[]),
      setCameraLookAt:vi.fn(),setBackground:vi.fn(),recenterCamera:vi.fn(),
    };
    const init=vi.fn((_uid:string,options:InitOptions)=>options.success(api));
    class SketchfabMock { init=init; }
    Object.assign(window,{Sketchfab:SketchfabMock});
    const props={selectedComponent:'body' as const,onSelectComponent:vi.fn(),view:'exterior' as const,onViewChange:vi.fn(),heatmap:false,findings};
    const {rerender}=render(<BmwAssetViewer {...props}/>);
    await waitFor(()=>expect(init).toHaveBeenCalledTimes(1));
    rerender(<BmwAssetViewer {...props} view="interior"/>);
    rerender(<BmwAssetViewer {...props}/>);
    await waitFor(()=>expect(init).toHaveBeenCalledTimes(2));
    expect(api.stop).toHaveBeenCalled();
  });

  it('reports initialization failure and keeps verified preview available', async () => {
    const onStatusChange=vi.fn();
    const init=vi.fn((_uid:string,options:InitOptions)=>options.error());
    class SketchfabMock { init=init; }
    Object.assign(window,{Sketchfab:SketchfabMock});
    render(<BmwAssetViewer selectedComponent="body" onSelectComponent={vi.fn()} view="exterior" onViewChange={vi.fn()} heatmap={false} findings={findings} onStatusChange={onStatusChange}/>);
    await waitFor(()=>expect(init).toHaveBeenCalled());

    expect(screen.getByRole('alert')).toHaveTextContent(/3D model could not load/i);
    expect(screen.getByRole('img',{name:/BMW i5 M60 three-quarter exterior preview/i})).toBeInTheDocument();
    expect(onStatusChange).toHaveBeenCalledWith('fallback');
  });

  it('offers retry after a failed API initialization and starts the model again',async()=>{
    const events:Record<string,(value?:any)=>void>={};
    const api={
      start:vi.fn(),stop:vi.fn(),addEventListener:vi.fn((name:string,callback:(value?:any)=>void)=>{events[name]=callback;}),
      getCameraLookAt:(callback:(error:unknown,camera:any)=>void)=>callback(null,{position:[2,2,4],target:[0,0,0]}),
      getNodeMap:(callback:(error:unknown,nodes:unknown)=>void)=>callback(null,[]),setCameraLookAt:vi.fn(),setBackground:vi.fn(),recenterCamera:vi.fn(),
    };
    const init=vi.fn((_uid:string,options:InitOptions)=>init.mock.calls.length===1?options.error():options.success(api));
    class SketchfabMock { init=init; }
    Object.assign(window,{Sketchfab:SketchfabMock});
    render(<BmwAssetViewer selectedComponent="body" onSelectComponent={vi.fn()} view="exterior" onViewChange={vi.fn()} heatmap={false} findings={findings}/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Retry 3D model'})).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button',{name:'Retry 3D model'}));
    await waitFor(()=>expect(init).toHaveBeenCalledTimes(2));
    act(()=>events.viewerready());
    expect(api.start).toHaveBeenCalled();
  });

  it('provides semantic orbit and zoom controls and honors reduced motion on reset',async()=>{
    Object.defineProperty(window,'matchMedia',{configurable:true,value:vi.fn(()=>({matches:true}))});
    const events:Record<string,(value?:any)=>void>={};
    const api={
      start:vi.fn(),stop:vi.fn(),addEventListener:vi.fn((name:string,callback:(value?:any)=>void)=>{events[name]=callback;}),
      getCameraLookAt:(callback:(error:unknown,camera:any)=>void)=>callback(null,{position:[2,2,4],target:[0,0,0]}),
      getNodeMap:(callback:(error:unknown,nodes:unknown)=>void)=>callback(null,[]),setCameraLookAt:vi.fn(),setBackground:vi.fn(),recenterCamera:vi.fn(),
    };
    class SketchfabMock { init(_uid:string,options:InitOptions){options.success(api);} }
    Object.assign(window,{Sketchfab:SketchfabMock});
    render(<BmwAssetViewer selectedComponent="body" onSelectComponent={vi.fn()} view="exterior" onViewChange={vi.fn()} heatmap={false} findings={findings}/>);
    await waitFor(()=>expect(api.start).toHaveBeenCalled());
    act(()=>events.viewerready());
    await waitFor(()=>expect(screen.getByRole('button',{name:'Zoom in'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Zoom in'}));
    expect(api.setCameraLookAt).toHaveBeenCalledWith([1.6,1.6,3.2],[0,0,0],0);
    fireEvent.click(screen.getByRole('button',{name:'Orbit model left'}));
    const [orbitPosition,orbitTarget]=api.setCameraLookAt.mock.lastCall!;
    expect(orbitTarget).toEqual([0,0,0]);
    // Sketchfab's native autospin is around Z; keep the camera's Z component fixed.
    expect(orbitPosition[0]).toBeCloseTo(2*Math.cos(-Math.PI/12)-2*Math.sin(-Math.PI/12));
    expect(orbitPosition[1]).toBeCloseTo(2*Math.sin(-Math.PI/12)+2*Math.cos(-Math.PI/12));
    expect(orbitPosition[2]).toBeCloseTo(4);
    fireEvent.click(screen.getByRole('button',{name:'Reset view'}));
    expect(api.setCameraLookAt).toHaveBeenLastCalledWith([2,2,4],[0,0,0],0);
  });
});
