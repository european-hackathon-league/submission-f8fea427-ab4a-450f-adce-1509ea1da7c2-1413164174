import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect} from 'vitest';
import {cleanup} from '@testing-library/react';
import {afterEach} from 'vitest';
import App from './App';

afterEach(()=>cleanup());

describe('vehicle insights workflows',()=>{
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
});
