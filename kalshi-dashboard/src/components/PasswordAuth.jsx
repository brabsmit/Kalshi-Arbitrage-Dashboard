import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

const PasswordAuth = ({ onAuthenticated }) => {
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const hashPassword = async (pwd) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(pwd);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        // Get password from environment variable
        const correctPassword = import.meta.env.VITE_APP_PASSWORD;

        // Debug: Log if password is undefined (remove in production)
        if (!correctPassword) {
            console.error('VITE_APP_PASSWORD is not set!');
            setError('Configuration error: Password not set. Check Railway environment variables.');
            setIsLoading(false);
            return;
        }

        // Check if correctPassword is a SHA-256 hash (64 hex characters)
        const isHash = /^[a-f0-9]{64}$/i.test(correctPassword);

        // Security: Use hashing if available, fallback to simple check for backward compatibility
        try {
            let isValid = false;

            if (isHash) {
                const hashedPassword = await hashPassword(password);
                isValid = (hashedPassword === correctPassword.toLowerCase());
            } else {
                // Legacy plaintext check
                isValid = (password === correctPassword);
            }

            if (isValid) {
                // Store auth token in sessionStorage (clears on browser close)
                sessionStorage.setItem('authenticated', 'true');
                onAuthenticated();
            } else {
                // Small delay to prevent timing attacks / brute force
                await new Promise(resolve => setTimeout(resolve, 500));
                setError('Incorrect password. Please try again.');
                setPassword('');
            }
        } catch (err) {
            console.error('Authentication error:', err);
            setError('An error occurred during authentication.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
                    {/* Header */}
                    <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-center">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-full mb-4">
                            <Lock size={32} className="text-white" />
                        </div>
                        <h1 className="text-2xl font-bold text-white mb-2">
                            Kalshi Arbitrage Dashboard
                        </h1>
                        <p className="text-blue-100 text-sm">
                            Protected Access
                        </p>
                    </div>

                    {/* Form */}
                    <div className="p-6">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-white mb-2">
                                    Enter Password
                                </label>
                                <div className="relative">
                                    <input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                        placeholder="Enter your password"
                                        autoFocus
                                        disabled={isLoading}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition-colors"
                                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    >
                                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
                                    <AlertCircle size={16} />
                                    <span>{error}</span>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={!password || isLoading}
                                className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02] active:scale-[0.98]"
                            >
                                {isLoading ? 'Verifying...' : 'Unlock Dashboard'}
                            </button>
                        </form>
                    </div>

                    {/* Footer */}
                    <div className="p-4 bg-white/5 border-t border-white/10 text-center text-xs text-white/60">
                        Authorized access only. All activity is monitored.
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PasswordAuth;
