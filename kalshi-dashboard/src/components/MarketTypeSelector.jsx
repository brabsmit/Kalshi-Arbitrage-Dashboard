import React from 'react';

const MarketTypeSelector = ({ selectedType, onSelect }) => {
    const options = [
        { id: 'moneyline', label: 'Moneyline' },
        { id: 'spreads', label: 'Spreads' },
        { id: 'totals', label: 'Totals' }
    ];

    return (
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
            {options.map((option) => (
                <button
                    key={option.id}
                    onClick={() => onSelect(option.id)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                        selectedType === option.id
                            ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-400 shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
                    }`}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
};

export default MarketTypeSelector;
