import React from 'react';
import { Flame, AlertTriangle, RefreshCw } from 'lucide-react';

export default function EmptyState({ 
  title = "No Fire Observations Detected", 
  message = "No satellite fire detections match the selected spatio-temporal filter or NASA FIRMS query.",
  actionLabel,
  onAction,
  icon: Icon = Flame
}) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-[#E5E5E5] rounded-2xl bg-[#FAFAFA] my-6 shadow-xs animate-fade-in-up">
      <div className="w-16 h-16 rounded-full bg-white border border-[#E5E5E5] flex items-center justify-center mb-4 text-[#111111] shadow-xs">
        <Icon className="w-8 h-8 opacity-90 text-[#111111]" />
      </div>
      <h3 className="text-lg font-semibold text-[#111111] mb-2 tracking-wide">
        {title}
      </h3>
      <p className="text-sm text-[#666666] max-w-md mb-6 leading-relaxed">
        {message}
      </p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#111111] hover:bg-[#222222] text-white font-medium rounded-lg text-sm shadow-sm transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
