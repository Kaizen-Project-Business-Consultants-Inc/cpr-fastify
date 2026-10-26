import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DataTable, { DataTableRow } from '../DataTable';

const columns = [
  { key: 'name', label: 'NAME', width: '1fr' },
  { key: 'email', label: 'EMAIL', width: '1fr' },
];

describe('DataTable', () => {
  it('renders column headers', () => {
    render(<DataTable columns={columns}>{null}</DataTable>);
    expect(screen.getByText('NAME')).toBeInTheDocument();
    expect(screen.getByText('EMAIL')).toBeInTheDocument();
  });

  it('renders children rows', () => {
    render(
      <DataTable columns={columns}>
        <DataTableRow columns={columns}>
          <span>Alice</span>
          <span>alice@test.com</span>
        </DataTableRow>
      </DataTable>,
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('alice@test.com')).toBeInTheDocument();
  });

  it('keeps labelled right-aligned numbers off the next column, but not an unlabelled actions column', () => {
    const cols = [
      { key: 'name', label: 'NAME', width: '1fr' },
      { key: 'count', label: 'COUNT', width: '1fr', align: 'right' as const },
      { key: 'actions', label: '', width: '1fr', align: 'right' as const },
    ];
    render(
      <DataTable columns={cols}>
        <DataTableRow columns={cols}>
          <span>Alice</span>
          <span>12</span>
          <span>View</span>
        </DataTableRow>
      </DataTable>,
    );
    expect(screen.getByText('COUNT')).toHaveStyle({ paddingRight: '16px' });
    expect(screen.getByText('NAME')).not.toHaveStyle({ paddingRight: '16px' });
    expect(screen.getByText('12').closest('[role=cell]')).toHaveStyle({ paddingRight: '16px' });
    expect(screen.getByText('Alice').closest('[role=cell]')).not.toHaveStyle({ paddingRight: '16px' });
    expect(screen.getByText('View').closest('[role=cell]')).not.toHaveStyle({ paddingRight: '16px' });
  });

  it('shows loading spinner when loading=true', () => {
    render(
      <DataTable columns={columns} loading>
        {null}
      </DataTable>,
    );
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('shows empty message when no children', () => {
    render(<DataTable columns={columns}>{undefined}</DataTable>);
    expect(screen.getByText('No results found.')).toBeInTheDocument();
  });

  it('shows custom empty message', () => {
    render(
      <DataTable columns={columns} emptyMessage="Nothing here">
        {undefined}
      </DataTable>,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('pagination footer shows "Showing X of Y results"', () => {
    render(
      <DataTable columns={columns} totalCount={50} shownCount={10}>
        <DataTableRow columns={columns}>
          <span>Alice</span>
          <span>alice@test.com</span>
        </DataTableRow>
      </DataTable>,
    );
    expect(screen.getByText('Showing 10 of 50 results')).toBeInTheDocument();
  });

  it('Prev button disabled on page 0', () => {
    render(
      <DataTable columns={columns} page={0} onPrevPage={() => {}} onNextPage={() => {}} hasNextPage>
        <DataTableRow columns={columns}>
          <span>Alice</span>
          <span>alice@test.com</span>
        </DataTableRow>
      </DataTable>,
    );
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
  });

  it('Next button disabled when hasNextPage=false', () => {
    render(
      <DataTable columns={columns} page={0} onPrevPage={() => {}} onNextPage={() => {}} hasNextPage={false}>
        <DataTableRow columns={columns}>
          <span>Alice</span>
          <span>alice@test.com</span>
        </DataTableRow>
      </DataTable>,
    );
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('calls onPrevPage when Prev clicked', () => {
    const onPrev = vi.fn();
    render(
      <DataTable columns={columns} page={1} onPrevPage={onPrev} onNextPage={() => {}} hasNextPage>
        <DataTableRow columns={columns}>
          <span>Alice</span>
          <span>alice@test.com</span>
        </DataTableRow>
      </DataTable>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('calls onNextPage when Next clicked', () => {
    const onNext = vi.fn();
    render(
      <DataTable columns={columns} page={0} onPrevPage={() => {}} onNextPage={onNext} hasNextPage>
        <DataTableRow columns={columns}>
          <span>Alice</span>
          <span>alice@test.com</span>
        </DataTableRow>
      </DataTable>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe('DataTableRow', () => {
  it('renders cells with role="cell"', () => {
    render(
      <DataTableRow columns={columns}>
        <span>Alice</span>
        <span>alice@test.com</span>
      </DataTableRow>,
    );
    const cells = screen.getAllByRole('cell');
    expect(cells).toHaveLength(2);
    expect(cells[0]).toHaveTextContent('Alice');
    expect(cells[1]).toHaveTextContent('alice@test.com');
  });

  it('onClick fires on click', () => {
    const handleClick = vi.fn();
    render(
      <DataTableRow columns={columns} onClick={handleClick}>
        <span>Alice</span>
        <span>alice@test.com</span>
      </DataTableRow>,
    );
    fireEvent.click(screen.getByRole('row'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('onClick fires on Enter key', () => {
    const handleClick = vi.fn();
    render(
      <DataTableRow columns={columns} onClick={handleClick}>
        <span>Alice</span>
        <span>alice@test.com</span>
      </DataTableRow>,
    );
    fireEvent.keyDown(screen.getByRole('row'), { key: 'Enter' });
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('has focus-visible styling when onClick provided', () => {
    const handleClick = vi.fn();
    render(
      <DataTableRow columns={columns} onClick={handleClick}>
        <span>Alice</span>
        <span>alice@test.com</span>
      </DataTableRow>,
    );
    const row = screen.getByRole('row');
    expect(row).toHaveAttribute('tabindex', '0');
  });
});
