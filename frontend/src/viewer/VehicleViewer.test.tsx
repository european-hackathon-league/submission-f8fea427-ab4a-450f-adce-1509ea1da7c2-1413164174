import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import VehicleViewer from './VehicleViewer';
import {findings} from '../domain/fixtures';

describe('VehicleViewer fallback', () => {
  it('keeps view and named component controls usable when WebGL is unavailable', () => {
    const onViewChange=vi.fn();
    const onSelectComponent=vi.fn();
    const onStatusChange=vi.fn();
    render(<VehicleViewer selectedComponent="body" onSelectComponent={onSelectComponent} view="exterior" onViewChange={onViewChange} heatmap period="2026" findings={findings} onStatusChange={onStatusChange}/>);

    expect(screen.getByRole('img',{name:/3d view unavailable/i})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Interior'}));
    fireEvent.click(screen.getByRole('button',{name:/Lighting/}));
    expect(onViewChange).toHaveBeenCalledWith('interior');
    expect(onSelectComponent).toHaveBeenCalledWith('lighting');
    expect(onStatusChange).toHaveBeenCalledWith('fallback');
  });
});
