import React, { useState, useEffect, useRef, useCallback } from 'react';

const EditIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block ml-2 opacity-0 group-hover:opacity-60 transition-opacity">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
    </svg>
);


interface EditableFieldProps {
  value: string | number;
  onSave: (value: string | number) => void;
  type?: 'text' | 'textarea' | 'number';
  className?: string;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
}

const EditableField: React.FC<EditableFieldProps> = ({ 
    value: initialValue, 
    onSave, 
    type = 'text', 
    className = '', 
    placeholder = "Editable",
    prefix = '',
    suffix = '',
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleSave = useCallback(() => {
    setIsEditing(false);
    // Only save if the value has actually changed
    if (value !== initialValue) {
      onSave(type === 'number' ? Number(value) || 0 : value);
    }
  }, [value, initialValue, onSave, type]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      setValue(initialValue);
      setIsEditing(false);
    }
  };
  
  const handleFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.select();
  };

  useEffect(() => {
    if (isEditing) {
        if (type === 'textarea') {
            textareaRef.current?.focus();
        } else {
            inputRef.current?.focus();
        }
    }
  }, [isEditing, type]);

  if (isEditing) {
    const commonProps = {
        value: value,
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(e.target.value),
        onBlur: handleSave,
        onKeyDown: handleKeyDown,
        onFocus: handleFocus,
        className: `bg-brand-bg border border-brand-primary rounded-md p-1 w-full focus:outline-none focus:ring-2 focus:ring-brand-primary/50 ${className}`
    };

    if (type === 'textarea') {
      return <textarea ref={textareaRef} {...commonProps} rows={3}></textarea>;
    }
    
    return <input ref={inputRef} type={type === 'number' ? 'number' : 'text'} {...commonProps} step={type === 'number' ? '0.1' : undefined}/>;
  }

  return (
    <span onClick={() => setIsEditing(true)} className={`cursor-pointer group hover:bg-brand-surface/50 p-1 -m-1 rounded-md transition-colors duration-200 ${className}`}>
      {prefix}
      {value !== null && value !== '' ? String(value) : <span className="text-brand-text-secondary/50 italic">{placeholder}</span>}
      {suffix}
      <EditIcon />
    </span>
  );
};

export default EditableField;