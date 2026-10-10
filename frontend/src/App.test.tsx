import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect} from 'vitest';
import {cleanup} from '@testing-library/react';
import {afterEach} from 'vitest';
import App from './App';

afterEach(()=>{cleanup();window.localStorage.clear();});

describe('vehicle insights workflows',()=>{
  it('leaves draft priority unscored when the selected context has no sample',async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.selectOptions(screen.getByRole('combobox',{name:'Market'}),'China');
    await user.selectOptions(screen.getByRole('combobox',{name:/^Period$/}),'2025');
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:/requirements/i}));
    await user.click(screen.getByRole('button',{name:'Reimagine'}));
    await user.click(screen.getAllByRole('button',{name:'Create draft requirement'})[0]);
    const draft=screen.getByRole('heading',{name:/Make body & access easier/}).closest('article')!;
    expect(draft).toHaveTextContent('Unscored');
    expect(draft).toHaveTextContent('No sample for this market and period');
  });

  it('labels evidence by its meaning and opens evidence for the selected component',async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(screen.getByRole('button',{name:'View evidence'}));
    const dialog=screen.getByRole('dialog');
    const card=within(dialog).getByText(/trunk gesture only works sometimes/).closest('article')!;
    expect(card).toHaveTextContent('Supporting signal');
    await user.click(within(dialog).getByRole('button',{name:'Explore research'}));
    const supporting=screen.getByRole('heading',{name:'Signals in the sample'}).parentElement!;
    expect(supporting).toHaveTextContent('trunk gesture only works sometimes');
    expect(supporting).not.toHaveTextContent('door handles are easier');
  });

  it('keeps baseline and current periods distinct when either changes',async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.selectOptions(screen.getByRole('combobox',{name:/^Period$/}),'2025');
    expect(screen.getByRole('combobox',{name:'Baseline period'})).toHaveValue('2026');
    await user.selectOptions(screen.getByRole('combobox',{name:'Baseline period'}),'2025');
    expect(screen.getByRole('combobox',{name:/^Period$/})).toHaveValue('2026');
  });

  it('compares the component selected in the vehicle explorer',async()=>{
    const user=userEvent.setup();
    render(<App/>);
    const navigation=within(screen.getByRole('navigation',{name:/main navigation/i}));
    await user.click(navigation.getByRole('button',{name:'Vehicle Explorer'}));
    await user.click(await screen.findByRole('button',{name:/Headlamps/}));
    await user.click(navigation.getByRole('button',{name:'Compare'}));
    expect(screen.getByRole('heading',{name:'Lighting & visibility'})).toBeInTheDocument();
    expect(screen.getByText('28%')).toBeInTheDocument();
    expect(screen.getAllByText('14%').length).toBeGreaterThan(0);
  });

  it('shows a newly created draft even when prior search and status filters exclude it',async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:/requirements/i}));
    await user.type(screen.getByRole('textbox',{name:'Search requirements'}),'nonexistent');
    await user.selectOptions(screen.getByRole('combobox',{name:'Filter requirements'}),'Approved');
    await user.click(screen.getByRole('button',{name:'Reimagine'}));
    await user.click(screen.getAllByRole('button',{name:/create draft requirement/i})[0]);
    expect(screen.getByRole('textbox',{name:'Search requirements'})).toHaveValue('');
    expect(screen.getByRole('combobox',{name:'Filter requirements'})).toHaveValue('All');
    expect(screen.getByRole('heading',{name:/Make body & access easier/i})).toBeInTheDocument();
  });
  it('opens evidence details and returns focus to the evidence action on Escape',async()=>{
    const user=userEvent.setup();
    render(<App/>);
    const evidence=screen.getByRole('button',{name:/view evidence/i});
    await user.click(evidence);
    expect(screen.getByRole('dialog',{name:/evidence/i})).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(evidence).toHaveFocus();
  });

  it('creates a draft requirement from a proposal and requires rationale before review',async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:/requirements/i}));
    await user.click(screen.getByRole('button',{name:/reimagine/i}));
    await user.click(screen.getAllByRole('button',{name:/create draft requirement/i})[0]);
    expect(screen.getByText(/draft requirement created/i)).toBeInTheDocument();
    const review=screen.getAllByRole('button',{name:/review/i})[0];
    await user.click(review);
    const dialog=screen.getByRole('dialog',{name:/review requirement/i});
    await user.click(within(dialog).getByRole('button',{name:/approve/i}));
    expect(within(dialog).getByText(/add a rationale/i)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/decision rationale/i),'Validated with the study panel.');
    await user.click(within(dialog).getByRole('button',{name:/approve/i}));
    expect(screen.getByText(/approved · version 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:/view version history/i}));
    expect(screen.getByText(/version 1 · draft/i)).toBeInTheDocument();
  });

  it('keeps unsupported market-period baselines visibly unavailable',async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:'Compare'}));
    await user.selectOptions(screen.getByRole('combobox',{name:'Market'}),'United States');
    await user.selectOptions(screen.getByRole('combobox',{name:'Period'}),'2025');
    expect(screen.getByRole('heading',{name:/no comparable baseline/i})).toBeInTheDocument();
    expect(screen.getByText(/has no 2025 longitudinal fixture/i)).toBeInTheDocument();
  });

  it('reports that added source files need backend analysis',async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:/data & history/i}));
    const file=new File(['feedback'], 'feedback.csv', {type:'text/csv'});
    await user.upload(screen.getByLabelText(/choose files to add/i),file);
    expect(screen.getByRole('status')).toHaveTextContent(/analysis requires backend integration/i);
    expect(screen.getAllByText(/feedback\.csv/).length).toBeGreaterThan(0);
    expect(screen.getByText(/no analysis run/i)).toBeInTheDocument();
  });
  it('keeps the summary count scoped to the selected market and period',async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.selectOptions(screen.getByRole('combobox',{name:'Market'}),'China');
    const metric=screen.getByText('Steering feedback').closest('.metric')!;
    expect(metric).toHaveTextContent('38%');
    expect(metric).toHaveTextContent('76 of 200 records');
    await user.selectOptions(screen.getByRole('combobox',{name:'Period'}),'2025');
    expect(metric).toHaveTextContent('No sample');
  });

  it('ignores malformed saved version history',async()=>{
    window.localStorage.setItem('fwd-history',JSON.stringify({'REQ-001':[{id:'REQ-001',componentId:'steering',version:1,status:'Draft',title:{invalid:true}}]}));
    const user=userEvent.setup();
    render(<App/>);
    await user.click(within(screen.getByRole('navigation',{name:/main navigation/i})).getByRole('button',{name:/requirements/i}));
    expect(screen.queryByRole('button',{name:/view version history/i})).not.toBeInTheDocument();
  });

});
