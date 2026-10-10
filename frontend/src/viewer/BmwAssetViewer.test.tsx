import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import BmwAssetViewer, {BMW_I5_MODEL_UID} from './BmwAssetViewer';
import {findings} from '../domain/fixtures';

type InitOptions={success:(api:any)=>void;error:()=>void};

afterEach(()=>cleanup());

describe('BmwAssetViewer', () => {
  it('shows real-asset attribution and keeps parent-controlled component selection usable', () => {
    const onSelectComponent=vi.fn();
    render(<BmwAssetViewer selectedComponent="body" onSelectComponent={onSelectComponent} view="exterior" onViewChange={vi.fn()} heatmap period="2026" findings={findings}/>);

    expect(screen.getByRole('link',{name:/Nazh Design/})).toHaveAttribute('href',expect.stringContaining('sketchfab.com'));
    expect(screen.getByRole('link',{name:/CC BY 4.0/})).toHaveAttribute('href','https://creativecommons.org/licenses/by/4.0/');
    expect(screen.getByRole('button',{name:/Headlamps/}).querySelector('.bmw-asset-viewer__part-dot')).toHaveStyle({'--heat':'#57b6a0'});
    fireEvent.click(screen.getByRole('button',{name:/Headlamps/}));
    expect(onSelectComponent).toHaveBeenCalledWith('lighting');
  });

  it('uses a licensed real G60 cabin photograph instead of claiming an unverified 3D interior', () => {
    const onSelectComponent=vi.fn();
    render(<BmwAssetViewer selectedComponent="dashboard" onSelectComponent={onSelectComponent} view="interior" onViewChange={vi.fn()} heatmap period="2026" findings={findings}/>);

    expect(screen.getByRole('img',{name:/BMW 5 Series G60 cabin reference photo/i})).toHaveAttribute('src','/vehicles/g60-interior.jpg');
    expect(screen.getByText(/3D cabin geometry unavailable/i)).toBeInTheDocument();
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
      getNodeMap:(callback:(error:unknown,nodes:any[])=>void)=>callback(null,[{instanceID:77,name:'headlamps'}]),
      getMaterialList:(callback:(error:unknown,materials:any[])=>void)=>callback(null,[{},{}]),
      setCameraLookAt:vi.fn(),recenterCamera:vi.fn(),
    };
    const init=vi.fn();
    class SketchfabMock { init(uid:string,options:InitOptions){init(uid,options);options.success(api);} }
    Object.assign(window,{Sketchfab:SketchfabMock});
    render(<BmwAssetViewer selectedComponent="body" onSelectComponent={onSelectComponent} view="exterior" onViewChange={vi.fn()} heatmap={false} period="2026" findings={findings} onStatusChange={onStatusChange}/>);

    await waitFor(()=>expect(init).toHaveBeenCalledWith(BMW_I5_MODEL_UID,expect.objectContaining({autospin:0,dnt:1})));
    expect(events.viewerready).toBeTypeOf('function');
    events.viewerready();
    await waitFor(()=>expect(onStatusChange).toHaveBeenCalledWith('ready'));
    events.click({instanceID:77});
    expect(onSelectComponent).toHaveBeenCalledWith('lighting');
  });

  it('reports initialization failure and keeps verified preview available', async () => {
    const onStatusChange=vi.fn();
    const init=vi.fn((_uid:string,options:InitOptions)=>options.error());
    class SketchfabMock { init=init; }
    Object.assign(window,{Sketchfab:SketchfabMock});
    render(<BmwAssetViewer selectedComponent="body" onSelectComponent={vi.fn()} view="exterior" onViewChange={vi.fn()} heatmap={false} period="2026" findings={findings} onStatusChange={onStatusChange}/>);
    await waitFor(()=>expect(init).toHaveBeenCalled());

    expect(screen.getByRole('alert')).toHaveTextContent(/3D model could not load/i);
    expect(screen.getByRole('img',{name:/BMW i5 M60 three-quarter exterior preview/i})).toBeInTheDocument();
    expect(onStatusChange).toHaveBeenCalledWith('fallback');
  });
});
