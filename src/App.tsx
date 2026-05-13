import React, { useState, useEffect } from 'react';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  sendPasswordResetEmail,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  onSnapshot, 
  orderBy, 
  addDoc, 
  deleteDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { 
  Droplets, 
  Plus, 
  History, 
  Lightbulb, 
  Settings, 
  LogOut, 
  LayoutDashboard,
  Calendar,
  Waves,
  ArrowRight,
  Loader2,
  Trash2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { UserConfig, RainfallEntry, User } from './types';
import { generateWaterSavingTips } from './lib/gemini';

// Utility for Tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- SCHEMA DEFINITIONS ---
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const signupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

const configSchema = z.object({
  roofArea: z.number().min(1, 'Roof area must be positive'),
  tankCapacity: z.number().min(1, 'Tank capacity must be positive'),
  runoffCoefficient: z.number().min(0).max(1, 'Coefficient must be between 0 and 1'),
});

const entrySchema = z.object({
  rainfallMm: z.number().min(0, 'Rainfall cannot be negative'),
});

// --- COMPONENTS ---

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger', size?: 'sm' | 'md' | 'lg' | 'icon' }>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none",
          variant === 'primary' && "bg-blue-600 text-white hover:bg-blue-700 shadow-md",
          variant === 'secondary' && "bg-slate-100 text-slate-900 hover:bg-slate-200",
          variant === 'ghost' && "bg-transparent hover:bg-slate-100 text-slate-600",
          variant === 'danger' && "bg-red-50 text-red-600 hover:bg-red-100",
          size === 'sm' && "px-3 py-1.5 text-sm",
          size === 'md' && "px-4 py-2.5",
          size === 'lg' && "px-6 py-3.5 text-lg",
          size === 'icon' && "h-10 w-10 p-0",
          className
        )}
        {...props}
      />
    );
  }
);

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { label?: string, error?: string }>(
  ({ label, error, className, id, ...props }, ref) => {
    return (
      <div className="w-full space-y-1.5">
        {label && <label htmlFor={id} className="text-sm font-medium text-slate-700 ml-1">{label}</label>}
        <input
          id={id}
          ref={ref}
          className={cn(
            "flex h-12 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-base transition-colors placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50",
            error && "border-red-500 focus:ring-red-500",
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-500 ml-1">{error}</p>}
      </div>
    );
  }
);

const Card = ({ children, className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn("glass-card rounded-2xl bg-white overflow-hidden", className)} {...props}>
    {children}
  </div>
);

// --- MAIN APP COMPONENT ---

enum View {
  auth_welcome,
  auth_login,
  auth_signup,
  auth_forgot,
  tracker_setup,
  tracker_dashboard,
  tracker_history,
  tracker_tips
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [appView, setAppView] = useState<View>(View.auth_welcome);
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [entries, setEntries] = useState<RainfallEntry[]>([]);
  const [tips, setTips] = useState<{tip: string, category: string}[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);

  // Setup Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        setUser({
          uid: fbUser.uid,
          email: fbUser.email,
          displayName: fbUser.displayName
        });
        
        // Load User Config
        const configPath = `users/${fbUser.uid}/config/main`;
        try {
          const configDoc = await getDoc(doc(db, configPath));
          if (configDoc.exists()) {
            setConfig(configDoc.data() as UserConfig);
            setAppView(View.tracker_dashboard);
          } else {
            setAppView(View.tracker_setup);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, configPath);
        }
      } else {
        setUser(null);
        setAppView(View.auth_welcome);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Setup Data Listener
  useEffect(() => {
    if (!user) return;
    
    const entriesPath = `users/${user.uid}/entries`;
    const q = query(
      collection(db, entriesPath),
      orderBy('createdAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entryList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as RainfallEntry[];
      setEntries(entryList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, entriesPath);
    });
    
    return unsubscribe;
  }, [user]);

  // Load Tips
  useEffect(() => {
    if (appView === View.tracker_tips && tips.length === 0) {
      generateWaterSavingTips().then(setTips);
    }
  }, [appView]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      </div>
    );
  }

  // Auth Functions
  const handleSignOut = () => signOut(auth);
  const totalLiters = entries.reduce((sum, entry) => sum + entry.litersCollected, 0);
  const totalLitersToday = entries.length > 0 && entries[0].date === format(new Date(), 'yyyy-MM-dd') 
    ? Math.round(entries[0].litersCollected) 
    : 0;

  const Sidebar = () => (
    <aside className="w-64 bg-slate-900 flex-col text-white hidden lg:flex h-full fixed left-0 top-0 z-50">
      <div className="p-6 flex items-center space-x-3">
        <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Droplets className="w-6 h-6 text-white" />
        </div>
        <span className="font-bold text-lg tracking-tight">Jal-Sanchay</span>
      </div>
      
      <nav className="flex-1 px-4 space-y-2 mt-4">
        {[
          { id: View.tracker_dashboard, icon: LayoutDashboard, label: 'Dashboard' },
          { id: View.tracker_setup, icon: Settings, label: 'System Setup' },
          { id: View.tracker_history, icon: History, label: 'Harvest History' },
          { id: View.tracker_tips, icon: Lightbulb, label: 'AI Water Tips' },
        ].map((item) => (
          <button
            key={item.label}
            onClick={() => setAppView(item.id)}
            className={cn(
              "w-full flex items-center px-4 py-3 rounded-xl space-x-3 transition-all duration-200 group",
              appView === item.id 
                ? "bg-blue-600 text-white shadow-md shadow-blue-600/20" 
                : "text-slate-400 hover:text-white hover:bg-white/5"
            )}
          >
            <item.icon className={cn("w-5 h-5 transition-colors", appView === item.id ? "text-white" : "group-hover:text-white")} />
            <span className="font-medium text-sm">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-6 border-t border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 uppercase font-bold text-xs">
            {user?.displayName?.charAt(0) || user?.email?.charAt(0) || 'U'}
          </div>
          <div className="text-xs truncate">
            <p className="font-medium text-white truncate max-w-[120px]">{user?.displayName || user?.email}</p>
            <p className="text-slate-500">Explorer Plan</p>
          </div>
        </div>
        <button 
          onClick={handleSignOut}
          className="mt-6 w-full text-left text-[10px] text-red-400 font-bold uppercase tracking-widest hover:text-red-300 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );

  // App View Components

  const Welcome = () => (
    <div className="flex flex-col items-center justify-center min-h-screen px-6 bg-slate-50 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
         <Waves className="absolute -top-20 -left-20 w-96 h-96 text-blue-500 animate-pulse" />
      </div>
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="z-10 text-center space-y-6 max-w-md"
      >
        <div className="mx-auto w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center shadow-xl shadow-blue-200">
          <Droplets className="w-10 h-10 text-white" />
        </div>
        <div>
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Jal-Sanchay</h1>
          <p className="text-lg text-slate-600 mt-2">Track your rainwater harvesting and save every drop for the future.</p>
        </div>
        
        <div className="pt-8 space-y-4">
          <Button className="w-full" size="lg" onClick={() => setAppView(View.auth_login)}>
            Sign In
          </Button>
          <Button className="w-full" variant="secondary" size="lg" onClick={() => setAppView(View.auth_signup)}>
            Create Account
          </Button>
        </div>
      </motion.div>
    </div>
  );

  const Login = () => {
    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof loginSchema>>({
      resolver: zodResolver(loginSchema)
    });

    const onSubmit = async (data: z.infer<typeof loginSchema>) => {
      setAuthError(null);
      try {
        await signInWithEmailAndPassword(auth, data.email, data.password);
      } catch (err: any) {
        setAuthError(err.message || 'Login failed');
      }
    };

    return (
      <div className="min-h-screen flex flex-col bg-white">
        <header className="p-6">
          <Button variant="ghost" size="icon" onClick={() => setAppView(View.auth_welcome)}>
            <Plus className="rotate-45 h-6 w-6" />
          </Button>
        </header>
        <main className="flex-1 p-6 space-y-8 max-w-md mx-auto w-full">
          <div>
            <h2 className="text-3xl font-bold text-slate-900">Welcome Back</h2>
            <p className="text-slate-500 mt-2">Sign in to continue tracking your impact.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input 
              label="Email" 
              type="email" 
              placeholder="hello@example.com"
              error={errors.email?.message}
              {...register('email')}
            />
            <Input 
              label="Password" 
              type="password" 
              placeholder="••••••••"
              error={errors.password?.message}
              {...register('password')}
            />
            {authError && (
              <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 p-3 rounded-xl border border-red-100">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p>{authError}</p>
              </div>
            )}
            <Button className="w-full" size="lg" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin h-5 w-5" /> : 'Sign In'}
            </Button>
          </form>

          <div className="text-center">
            <button 
              className="text-sm font-medium text-blue-600"
              onClick={() => setAppView(View.auth_forgot)}
            >
              Forgot Password?
            </button>
          </div>
        </main>
      </div>
    );
  };

  const Signup = () => {
    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof signupSchema>>({
      resolver: zodResolver(signupSchema)
    });

    const onSubmit = async (data: z.infer<typeof signupSchema>) => {
      setAuthError(null);
      try {
        await createUserWithEmailAndPassword(auth, data.email, data.password);
      } catch (err: any) {
        setAuthError(err.message || 'Signup failed');
      }
    };

    return (
      <div className="min-h-screen flex flex-col bg-white">
        <header className="p-6">
          <Button variant="ghost" size="icon" onClick={() => setAppView(View.auth_welcome)}>
            <Plus className="rotate-45 h-6 w-6" />
          </Button>
        </header>
        <main className="flex-1 p-6 space-y-8 max-w-md mx-auto w-full">
          <div>
            <h2 className="text-3xl font-bold text-slate-900">Create Account</h2>
            <p className="text-slate-500 mt-2">Start your journey to save rainwater.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input 
              label="Full Name" 
              placeholder="John Doe"
              error={errors.name?.message}
              {...register('name')}
            />
            <Input 
              label="Email" 
              type="email" 
              placeholder="hello@example.com"
              error={errors.email?.message}
              {...register('email')}
            />
            <Input 
              label="Password" 
              type="password" 
              placeholder="••••••••"
              error={errors.password?.message}
              {...register('password')}
            />
            <Input 
              label="Confirm Password" 
              type="password" 
              placeholder="••••••••"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />
            {authError && (
              <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 p-3 rounded-xl border border-red-100">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p>{authError}</p>
              </div>
            )}
            <Button className="w-full" size="lg" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin h-5 w-5" /> : 'Create Account'}
            </Button>
          </form>
        </main>
      </div>
    );
  };

  const Setup = () => {
    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof configSchema>>({
      resolver: zodResolver(configSchema),
      defaultValues: {
        roofArea: config?.roofArea || 500,
        tankCapacity: config?.tankCapacity || 2000,
        runoffCoefficient: config?.runoffCoefficient || 0.8
      }
    });

    const onSubmit = async (data: z.infer<typeof configSchema>) => {
      if (!user) return;
      try {
        const payload = {
          ...data,
          updatedAt: serverTimestamp()
        };
        const configPath = `users/${user.uid}/config/main`;
        try {
          await setDoc(doc(db, configPath), payload);
          setConfig(payload as UserConfig);
          setAppView(View.tracker_dashboard);
        } catch (err: any) {
          handleFirestoreError(err, OperationType.WRITE, configPath);
        }
      } catch (err: any) {
        console.error(err);
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center p-6 pt-12">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <Settings className="w-12 h-12 text-blue-600 mx-auto" />
            <h2 className="text-2xl font-bold mt-4">System Setup</h2>
            <p className="text-slate-500">Configure your harvesting hardware details.</p>
          </div>

          <Card className="p-6">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <Input 
                id="roofArea" 
                label="Roof Area (sq ft)" 
                type="number"
                step="0.1"
                error={errors.roofArea?.message}
                {...register('roofArea', { valueAsNumber: true })}
              />
              <Input 
                id="tankCapacity" 
                label="Tank Capacity (Liters)" 
                type="number"
                error={errors.tankCapacity?.message}
                {...register('tankCapacity', { valueAsNumber: true })}
              />
              <Input 
                id="runoffCoefficient" 
                label="Runoff Coefficient (0.0 - 1.0)" 
                type="number"
                step="0.01"
                placeholder="0.8 (Typical)"
                error={errors.runoffCoefficient?.message}
                {...register('runoffCoefficient', { valueAsNumber: true })}
              />
              <div className="pt-2">
                <Button className="w-full" size="lg" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="animate-spin h-5 w-5" /> : 'Save Configuration'}
                </Button>
              </div>
            </form>
          </Card>
          
          <div className="text-xs text-slate-400 text-center px-4 leading-relaxed">
            * Runoff coefficient helps estimate real collection efficiency. Typical values: Concrete (0.8), Metal (0.9), Tiles (0.8).
          </div>
        </div>
      </div>
    );
  };

  const Dashboard = () => {
    const [submitting, setSubmitting] = useState(false);
    const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof entrySchema>>({
      resolver: zodResolver(entrySchema)
    });

    const totalLiters = entries.reduce((sum, entry) => sum + entry.litersCollected, 0);
    const fillPercent = config ? Math.min(Math.round((totalLiters / config.tankCapacity) * 100), 100) : 0;
    
    // Last 7 days chart data
    const chartData = entries.slice(0, 7).reverse().map(e => ({
      date: format(new Date(e.date), 'MMM d'),
      liters: Math.round(e.litersCollected)
    }));

    const onSubmit = async (data: z.infer<typeof entrySchema>) => {
      if (!user || !config) return;
      setSubmitting(true);
      try {
        const liters = config.roofArea * 0.0929 * data.rainfallMm * config.runoffCoefficient;
        const entriesPath = `users/${user.uid}/entries`;
        try {
          await addDoc(collection(db, entriesPath), {
            date: format(new Date(), 'yyyy-MM-dd'),
            rainfallMm: data.rainfallMm,
            litersCollected: liters,
            createdAt: serverTimestamp()
          });
          reset();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, entriesPath);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="flex-1 flex flex-col p-6 lg:p-8 space-y-6 overflow-x-hidden">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-slate-800">Water Harvesting Overview</h1>
          <div className="flex items-center space-x-4">
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Cloud Synced
            </span>
            {config && (
              <div className="text-right hidden sm:block">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Configuration</p>
                <p className="text-sm font-semibold text-slate-700">
                  {config.roofArea} sq.ft • Runoff: {config.runoffCoefficient}
                </p>
              </div>
            )}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full items-start">
          <div className="lg:col-span-8 space-y-6 order-2 lg:order-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              <Card className="p-6 bg-white">
                <p className="text-sm text-slate-500 font-medium mb-1">Today's Water Saved</p>
                <div className="flex items-baseline space-x-2">
                  <h2 className="text-3xl font-bold text-slate-900">{totalLitersToday.toLocaleString()}</h2>
                  <span className="text-slate-400 font-medium">Liters</span>
                </div>
                <div className="mt-4 flex items-center text-xs text-blue-600 font-semibold">
                  <Plus className="w-3 h-3 mr-1" /> Logged today
                </div>
              </Card>
              <Card className="p-6 bg-white">
                <p className="text-sm text-slate-500 font-medium mb-1">Total Collection (Life)</p>
                <div className="flex items-baseline space-x-2">
                  <h2 className="text-3xl font-bold text-slate-900">{Math.round(totalLiters).toLocaleString()}</h2>
                  <span className="text-slate-400 font-medium">Liters</span>
                </div>
                <div className="mt-4 flex items-center text-xs text-slate-400">
                  <CheckCircle2 className="w-3 h-3 mr-1 text-slate-300" /> Great contribution
                </div>
              </Card>
            </div>

            <Card className="p-6 bg-white">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Droplets className="w-5 h-5 text-blue-500" />
                Daily Rainfall Entry
              </h3>
              <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Rainfall (mm)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    placeholder="12.5" 
                    {...register('rainfallMm', { valueAsNumber: true })}
                    className={cn(
                      "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:outline-none text-slate-700 font-medium",
                      errors.rainfallMm && "border-red-500"
                    )}
                  />
                  {errors.rainfallMm && <p className="text-xs text-red-500 mt-1">{errors.rainfallMm.message}</p>}
                </div>
                <Button className="w-full sm:w-auto h-[50px] shadow-lg shadow-blue-500/20" type="submit" disabled={submitting}>
                  {submitting ? <Loader2 className="animate-spin h-5 w-5" /> : 'Log Rainfall'}
                </Button>
              </form>
            </Card>

            <Card className="p-6 bg-white overflow-hidden">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-slate-800">Recent Savings (L)</h3>
                <span className="text-xs font-bold text-blue-600 cursor-pointer hover:underline" onClick={() => setAppView(View.tracker_history)}>
                  View History
                </span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="date" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 11, fill: '#94a3b8' }} 
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 11, fill: '#94a3b8' }} 
                      />
                      <Tooltip 
                        cursor={{ fill: '#f8fafc' }}
                        contentStyle={{ 
                          borderRadius: '12px', 
                          border: 'none', 
                          boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                          fontSize: '12px'
                        }}
                      />
                      <Bar dataKey="liters" radius={[6, 6, 0, 0]} barSize={24}>
                        {chartData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={index === chartData.length - 1 ? '#2563eb' : '#cbd5e1'} />
                        ))}
                      </Bar>
                    </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="lg:col-span-4 space-y-6 order-1 lg:order-2">
            <Card className="p-6 bg-white flex flex-col items-center min-h-[460px]">
              <h3 className="text-lg font-bold text-slate-800 mb-8">Tank Utilization</h3>
              
              <div className="relative w-40 h-80 bg-slate-50 rounded-full border-4 border-slate-100 p-2 overflow-hidden shadow-inner">
                <motion.div 
                  initial={{ height: 0 }}
                  animate={{ height: `${fillPercent}%` }}
                  transition={{ duration: 1.5, ease: 'easeOut' }}
                  className="absolute bottom-0 left-0 right-0 tank-gradient liquid-wave"
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
                  <span className="text-3xl font-black text-white drop-shadow-lg">{fillPercent}%</span>
                  <span className="text-xs font-bold text-white uppercase tracking-widest opacity-80">Full</span>
                </div>
              </div>

              <div className="mt-8 text-center">
                <p className="text-sm font-semibold text-slate-700">
                  {Math.round(totalLiters).toLocaleString()} / {config?.tankCapacity.toLocaleString()} Liters
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Storage capacity remaining: {Math.max(0, Math.round(config?.tankCapacity! - totalLiters)).toLocaleString()}L
                </p>
              </div>

              <div className="mt-auto w-full bg-blue-50/50 p-4 rounded-2xl border border-blue-100/50">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold text-blue-700 uppercase tracking-widest">Growth Note</span>
                </div>
                <p className="text-[11px] text-blue-900 leading-relaxed font-medium">
                  {fillPercent > 80 ? "Your tank is nearly full! Consider prioritized usage." : "Ample storage space available for the next rainfall."}
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    );
  };

  const HistoryView = () => {
    const handleDelete = async (id: string) => {
      if (!user) return;
      if (!window.confirm('Delete this entry?')) return;
      const entryPath = `users/${user.uid}/entries/${id}`;
      try {
        await deleteDoc(doc(db, entryPath));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, entryPath);
      }
    };

    return (
      <div className="flex-1 flex flex-col p-6 lg:p-8 space-y-6">
        <header className="mb-4">
          <p className="text-sm font-medium text-slate-400 uppercase tracking-wider">Tracker</p>
          <h1 className="text-2xl font-bold text-slate-900">History</h1>
        </header>

        <Card className="overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-400 uppercase border-b border-slate-100 bg-slate-50/50">
                <tr>
                  <th className="px-6 py-4 font-bold">Date</th>
                  <th className="px-6 py-4 font-bold">Rainfall</th>
                  <th className="px-6 py-4 font-bold text-right">Collected</th>
                  <th className="px-6 py-4 font-bold text-right italic">Action</th>
                </tr>
              </thead>
              <tbody className="text-slate-600 divide-y divide-slate-50">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-20 text-center text-slate-400 italic">
                      No logs found. Start logging to see history.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4 font-medium text-slate-900 whitespace-nowrap">
                        {format(new Date(entry.date), 'MMM d, yyyy')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 bg-slate-100 rounded-lg font-medium text-slate-700">
                          {entry.rainfallMm} mm
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-slate-900 whitespace-nowrap">
                        {Math.round(entry.litersCollected).toLocaleString()} L
                      </td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                         <button 
                          onClick={() => entry.id && handleDelete(entry.id)}
                          className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                         >
                            <Trash2 className="h-4 w-4" />
                         </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  };

  const TipsView = () => {
    return (
      <div className="flex-1 flex flex-col p-6 lg:p-8 space-y-6 overflow-x-hidden">
        <header className="flex justify-between items-center">
          <div>
            <p className="text-sm font-medium text-slate-400 uppercase tracking-wider">Discovery</p>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Conservation Tips</h1>
          </div>
          <Button variant="secondary" size="sm" className="hidden sm:flex" onClick={() => generateWaterSavingTips().then(setTips)}>
            Refresh Tips
          </Button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {tips.length === 0 ? (
            <>
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-slate-200 h-40 rounded-2xl animate-pulse" />
              ))}
            </>
          ) : (
            tips.map((tip, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
              >
                <Card className="p-6 bg-white h-full hover:shadow-md transition-shadow flex flex-col justify-between">
                  <div>
                    <span className="inline-block px-2.5 py-1 bg-blue-50 text-blue-700 text-[10px] font-bold uppercase rounded-lg mb-4 tracking-widest">
                      {tip.category}
                    </span>
                    <p className="text-slate-800 text-lg leading-relaxed font-semibold">"{tip.tip}"</p>
                  </div>
                  <div className="flex justify-end mt-6">
                    <CheckCircle2 className="h-6 w-6 text-blue-500 opacity-20" />
                  </div>
                </Card>
              </motion.div>
            ))
          )}
        </div>
      </div>
    );
  };

  const Nav = () => (
    <nav className="fixed bottom-0 left-0 right-0 h-20 bg-white/80 backdrop-blur-xl border-t border-slate-100 px-8 flex items-center justify-between z-50 lg:hidden">
      {[
        { id: View.tracker_dashboard, icon: LayoutDashboard, label: 'Home' },
        { id: View.tracker_history, icon: History, label: 'History' },
        { id: View.tracker_tips, icon: Lightbulb, label: 'AI Tips' },
        { id: 'signout', icon: LogOut, label: 'Sign Out' }
      ].map((item) => (
        <button
          key={item.label}
          onClick={() => {
            if (item.id === 'signout') handleSignOut();
            else setAppView(item.id as View);
          }}
          className={cn(
            "flex flex-col items-center gap-1 transition-all duration-300",
            appView === item.id ? "text-blue-600 scale-110" : "text-slate-400 hover:text-slate-600"
          )}
        >
          <item.icon className={cn("h-6 w-6", appView === item.id && "fill-blue-50")} />
          <span className="text-[10px] font-bold uppercase tracking-widest">{item.label}</span>
        </button>
      ))}
    </nav>
  );

  const ForgotPassword = () => {
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const onSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setAuthError(null);
      setSubmitting(true);
      try {
        await sendPasswordResetEmail(auth, email);
        setSent(true);
      } catch (err: any) {
        setAuthError(err.message || 'Failed to send reset email');
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="min-h-screen flex flex-col bg-white">
        <header className="p-6">
          <Button variant="ghost" size="icon" onClick={() => setAppView(View.auth_login)}>
            <Plus className="rotate-45 h-6 w-6" />
          </Button>
        </header>
        <main className="flex-1 p-6 space-y-8 max-w-md mx-auto w-full">
          <div>
            <h2 className="text-3xl font-bold text-slate-900">Reset Password</h2>
            <p className="text-slate-500 mt-2">Enter your email and we'll send you a link.</p>
          </div>

          {sent ? (
            <div className="text-center space-y-4">
              <div className="mx-auto w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <p className="text-slate-600">Reset link sent! Check your inbox.</p>
              <Button className="w-full" variant="secondary" onClick={() => setAppView(View.auth_login)}>
                Back to Login
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <Input 
                label="Email" 
                type="email" 
                placeholder="hello@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {authError && (
                <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 p-3 rounded-xl border border-red-100">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <p>{authError}</p>
                </div>
              )}
              <Button className="w-full" size="lg" type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="animate-spin h-5 w-5" /> : 'Send Reset Link'}
              </Button>
            </form>
          )}
        </main>
      </div>
    );
  };

  const isTrackerView = appView === View.tracker_dashboard || appView === View.tracker_history || appView === View.tracker_tips || appView === View.tracker_setup;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900 lg:flex">
      {isTrackerView && <Sidebar />}
      
      <div className={cn(
        "flex-1 min-h-screen",
        isTrackerView && "lg:ml-64"
      )}>
        <AnimatePresence mode="wait">
          {appView === View.auth_welcome && <Welcome key="welcome" />}
          {appView === View.auth_login && <Login key="login" />}
          {appView === View.auth_signup && <Signup key="signup" />}
          {appView === View.auth_forgot && <ForgotPassword key="forgot" />}
          {appView === View.tracker_setup && (
            <div className="flex flex-col flex-1 p-6 lg:p-8">
               <Setup key="setup" />
            </div>
          )}
          {appView === View.tracker_dashboard && <Dashboard key="dashboard" />}
          {appView === View.tracker_history && <HistoryView key="history" />}
          {appView === View.tracker_tips && <TipsView key="tips" />}
        </AnimatePresence>
        {isTrackerView && appView !== View.tracker_setup && <Nav />}
      </div>
    </div>
  );
}
