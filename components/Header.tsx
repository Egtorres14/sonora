
import React from 'react';

export const Header: React.FC = () => {
    return (
        <header className="w-full py-4 px-8 border-b border-brand-border bg-brand-surface/30 backdrop-blur-sm sticky top-0 z-10">
            <div className="container mx-auto flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-brand-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                </svg>
                <h1 className="text-xl font-bold text-brand-text tracking-wide">Audio Evaluator AI</h1>
            </div>
        </header>
    );
};
