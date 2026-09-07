
import React from 'react';

interface RatingCircleProps {
  score: number;
}

const RatingCircle: React.FC<RatingCircleProps> = ({ score }) => {
  const normalizedScore = Math.max(0, Math.min(10, score));
  const percentage = normalizedScore * 10;
  const circumference = 2 * Math.PI * 45; // r = 45
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const getColor = (s: number) => {
    if (s >= 8) return '#3DE8A6'; // brand-secondary
    if (s >= 5) return '#FBBF24'; // amber-400
    return '#F87171'; // red-400
  };
  
  const color = getColor(normalizedScore);

  return (
    <div className="relative flex items-center justify-center w-28 h-28">
      <svg className="w-full h-full" viewBox="0 0 100 100">
        <circle
          className="text-brand-border"
          strokeWidth="10"
          stroke="currentColor"
          fill="transparent"
          r="45"
          cx="50"
          cy="50"
        />
        <circle
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          stroke={color}
          fill="transparent"
          r="45"
          cx="50"
          cy="50"
          style={{ transition: 'stroke-dashoffset 0.5s ease-out' }}
        />
      </svg>
      <span className="absolute text-3xl font-bold" style={{ color }}>
        {normalizedScore.toFixed(1)}
      </span>
    </div>
  );
};

export default RatingCircle;
