import React, { useState } from 'react';
import { Key, ExternalLink, X, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
import { validateFIRMSKey, saveBackendFIRMSKey, queryLiveFIRMS } from '../services/api';

export default function FIRMSSettingsModal({ isOpen, onClose, mapKey, onSaveKey, hasEnvKey }) {
  const [inputKey, setInputKey] = useState(mapKey || "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  if (!isOpen) return null;

  const handleSave = async () => {
    const cleanKey = inputKey.trim();
    if (cleanKey) {
      try {
        await saveBackendFIRMSKey(cleanKey);
      } catch (err) {
        console.warn("Could not persist key to backend:", err);
      }
    }
    onSaveKey(cleanKey);
    onClose();
  };

  const handleTestKey = async () => {
    const key = inputKey.trim();
    if (!key) {
      setTestResult({ success: false, message: "Please enter a NASA FIRMS MAP_KEY." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      // First attempt direct verification via NASA EOSDIS availability endpoint
      const data = await validateFIRMSKey(key);
      if (data.success) {
        setTestResult({ 
          success: true, 
          message: data.message || "Valid NASA FIRMS Map Key! Successfully authenticated with NASA EOSDIS." 
        });
      } else {
        setTestResult({ 
          success: false, 
          message: data.message || "Key validation failed against NASA FIRMS servers." 
        });
      }
    } catch (err) {
      setTestResult({ 
        success: false, 
        message: err.message || "Network error connecting to verification service." 
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white border border-[#E5E5E5] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-fade-in-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5] bg-[#FAFAFA]">
          <div className="flex items-center gap-2 text-[#111111]">
            <Key className="w-5 h-5 text-[#111111]" />
            <h3 className="font-semibold text-[#111111] text-base">NASA FIRMS API Key Configuration</h3>
          </div>
          <button 
            onClick={onClose}
            className="text-[#666666] hover:text-[#111111] transition-colors p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-[#666666] leading-relaxed">
            IGNIS queries official NASA FIRMS REST APIs for real-time active fire observations from MODIS (Terra/Aqua) and VIIRS (S-NPP/NOAA-20/NOAA-21).
          </p>

          {hasEnvKey && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs">
              <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-700" />
              <span>A server-side NASA FIRMS key is currently configured in backend .env.</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#888888] mb-1.5 uppercase tracking-wider">
              Your FIRMS MAP_KEY (32 Characters)
            </label>
            <input
              type="text"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="e.g. 7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d"
              className="w-full px-3.5 py-2.5 bg-[#FAFAFA] border border-[#E5E5E5] focus:border-[#111111] rounded-lg text-sm text-[#111111] font-mono placeholder:text-[#888888] focus:outline-none transition-colors"
            />
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            <a
              href="https://firms.modaps.eosdis.nasa.gov/api/map_key/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[#111111] font-medium hover:underline"
            >
              <span>Get a free key from NASA EOSDIS</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <button
              type="button"
              onClick={handleTestKey}
              disabled={testing || !inputKey.trim()}
              className="px-3 py-1.5 bg-[#F5F5F5] hover:bg-[#E5E5E5] disabled:opacity-50 text-[#111111] border border-[#E5E5E5] rounded text-xs font-medium transition-all"
            >
              {testing ? "Testing..." : "Test Key"}
            </button>
          </div>

          {testResult && (
            <div className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
              testResult.success 
                ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
                : "bg-rose-50 border-rose-200 text-rose-800"
            }`}>
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-700" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#E5E5E5] bg-[#FAFAFA]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[#666666] hover:text-[#111111] font-medium font-sans transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-[#111111] hover:bg-[#222222] text-white font-medium font-sans text-sm rounded-lg shadow-sm transition-all"
          >
            Save Key
          </button>
        </div>
      </div>
    </div>
  );
}
