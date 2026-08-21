import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { AdminSidebar } from '../components/AdminSidebar';
import { AnalyticsCharts } from '../components/AnalyticsCharts';
import { ToastNotification } from '../components/ToastNotification';
import { ToastMessage } from '../types';
import {
    Users,
    Layers,
    MonitorPlay,
    Clock,
    Plus,
    Edit2,
    Trash2,
    RefreshCw,
    CircleDot,
    ShieldAlert,
    UserCheck,
    UserX,
    Play,
    Settings
} from 'lucide-react';

export const AdminDashboardPage: React.FC = () => {
    const { user, token } = useAuth();
    const { socket } = useSocket();
    const [activeTab, setActiveTab] = useState<string>('overview');
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    // States for DB data
    const [dashboardStats, setDashboardStats] = useState<any>(null);
    const [usersList, setUsersList] = useState<any[]>([]);
    const [servicesList, setServicesList] = useState<any[]>([]);
    const [countersList, setCountersList] = useState<any[]>([]);
    const [liveMonitorData, setLiveMonitorData] = useState<any[]>([]);
    const [analyticsData, setAnalyticsData] = useState<any>(null);

    // Form Modals / Edit states
    const [showUserModal, setShowUserModal] = useState(false);
    const [editUserId, setEditUserId] = useState<string | null>(null);
    const [userForm, setUserForm] = useState({ name: '', email: '', password: '', role: 'STAFF' });

    const [showServiceModal, setShowServiceModal] = useState(false);
    const [editServiceId, setEditServiceId] = useState<string | null>(null);
    const [serviceForm, setServiceForm] = useState({ name: '', code: '', description: '' });

    const [showCounterModal, setShowCounterModal] = useState(false);
    const [editCounterId, setEditCounterId] = useState<string | null>(null);
    const [counterForm, setCounterForm] = useState({ name: '', service_id: '', status: 'CLOSED' });

    const [assignCounterId, setAssignCounterId] = useState<string | null>(null);
    const [assignStaffId, setAssignStaffId] = useState<string>('');

    // Toast Helper
    const addToast = (title: string, message: string, type: 'success' | 'error' | 'warning' = 'warning') => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts((prev) => [...prev, { id, title, message, type }]);
    };

    const dismissToast = (id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    };

    // REST API utility calls
    const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(options.headers || {})
        };
        const res = await fetch(url, { ...options, headers });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'Server request failed');
        }
        return data;
    };

    // Core Data Fetchers
    const loadDashboardStats = async () => {
        try {
            const data = await fetchWithAuth('/api/admin/dashboard');
            setDashboardStats(data);
        } catch (err: any) {
            addToast('Error', 'Failed to fetch dashboard statistics', 'error');
        }
    };

    const loadUsers = async () => {
        try {
            const data = await fetchWithAuth('/api/admin/users');
            setUsersList(data);
        } catch (err: any) {
            addToast('Error', 'Failed to fetch users list', 'error');
        }
    };

    const loadServices = async () => {
        try {
            const data = await fetchWithAuth('/api/admin/services');
            setServicesList(data);
        } catch (err: any) {
            addToast('Error', 'Failed to fetch services', 'error');
        }
    };

    const loadCounters = async () => {
        try {
            const data = await fetchWithAuth('/api/admin/counters');
            setCountersList(data);
        } catch (err: any) {
            addToast('Error', 'Failed to fetch counters', 'error');
        }
    };

    const loadLiveMonitor = async () => {
        try {
            const data = await fetchWithAuth('/api/admin/live-monitor');
            setLiveMonitorData(data);
        } catch (err: any) {
            addToast('Error', 'Failed to fetch live monitor state', 'error');
        }
    };

    const loadAnalytics = async () => {
        try {
            const data = await fetchWithAuth('/api/admin/analytics');
            setAnalyticsData(data);
        } catch (err: any) {
            addToast('Error', 'Failed to generate analytics', 'error');
        }
    };

    // Trigger loading based on active panel
    const reloadActiveTabData = async () => {
        setLoading(true);
        setError(null);
        try {
            if (activeTab === 'overview') {
                await loadDashboardStats();
            } else if (activeTab === 'users' || activeTab === 'staff') {
                await loadUsers();
            } else if (activeTab === 'services') {
                await loadServices();
            } else if (activeTab === 'counters') {
                await Promise.all([loadCounters(), loadServices(), loadUsers()]);
            } else if (activeTab === 'live-monitor') {
                await loadLiveMonitor();
            } else if (activeTab === 'analytics') {
                await loadAnalytics();
            }
        } catch (err: any) {
            setError(err.message || 'Failed to refresh page data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        reloadActiveTabData();
    }, [activeTab]);

    // Real-time socket sync connection
    useEffect(() => {
        if (!socket) return;

        const handleQueueUpdate = () => {
            // Pull updates automatically based on active tab
            if (activeTab === 'live-monitor') {
                loadLiveMonitor();
            } else if (activeTab === 'overview') {
                loadDashboardStats();
            } else if (activeTab === 'analytics') {
                loadAnalytics();
            } else if (activeTab === 'counters') {
                loadCounters();
            }
        };

        const events = [
            'QUEUE_UPDATED',
            'TOKEN_CALLED',
            'TOKEN_COMPLETED',
            'TOKEN_SKIPPED',
            'TOKEN_HELD',
            'TOKEN_RESUMED',
            'COUNTER_STATUS_CHANGED',
            'token_called',
            'token_completed',
            'token_state_changed',
            'counter_status_changed',
            'queue_updated'
        ];

        events.forEach((evt) => socket.on(evt, handleQueueUpdate));

        return () => {
            events.forEach((evt) => socket.off(evt, handleQueueUpdate));
        };
    }, [socket, activeTab]);

    // USER CRUD Events
    const handleUserSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editUserId) {
                await fetchWithAuth(`/api/admin/users/${editUserId}`, {
                    method: 'PATCH',
                    body: JSON.stringify(userForm)
                });
                addToast('Success', 'User profile updated successfully', 'success');
            } else {
                await fetchWithAuth('/api/admin/users', {
                    method: 'POST',
                    body: JSON.stringify(userForm)
                });
                addToast('Success', 'New user account created successfully', 'success');
            }
            setShowUserModal(false);
            setEditUserId(null);
            setUserForm({ name: '', email: '', password: '', role: 'STAFF' });
            loadUsers();
        } catch (err: any) {
            addToast('Error', err.message || 'Operation failed', 'error');
        }
    };

    const handleEditUser = (u: any) => {
        setEditUserId(u.id);
        setUserForm({ name: u.name, email: u.email, password: '', role: u.role });
        setShowUserModal(true);
    };

    const handleDeleteUser = async (id: string, name: string) => {
        if (!window.confirm(`Are you absolutely sure you want to deactivate and delete user account '${name}'?`)) return;
        try {
            await fetchWithAuth(`/api/admin/users/${id}`, { method: 'DELETE' });
            addToast('Success', `User account '${name}' has been deleted`, 'success');
            loadUsers();
        } catch (err: any) {
            addToast('Error', err.message || 'Failed to delete user', 'error');
        }
    };

    // SERVICE CRUD Events
    const handleServiceSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editServiceId) {
                await fetchWithAuth(`/api/admin/services/${editServiceId}`, {
                    method: 'PATCH',
                    body: JSON.stringify(serviceForm)
                });
                addToast('Success', 'Service updated successfully', 'success');
            } else {
                await fetchWithAuth('/api/admin/services', {
                    method: 'POST',
                    body: JSON.stringify(serviceForm)
                });
                addToast('Success', 'Service created successfully', 'success');
            }
            setShowServiceModal(false);
            setEditServiceId(null);
            setServiceForm({ name: '', code: '', description: '' });
            loadServices();
        } catch (err: any) {
            addToast('Error', err.message || 'Operation failed', 'error');
        }
    };

    const handleEditService = (s: any) => {
        setEditServiceId(s.id);
        setServiceForm({ name: s.name, code: s.code, description: s.description || '' });
        setShowServiceModal(true);
    };

    const handleDeleteService = async (id: string, name: string) => {
        if (!window.confirm(`WARNING: Deleting '${name}' cannot be undone. Are you sure?`)) return;
        try {
            await fetchWithAuth(`/api/admin/services/${id}`, { method: 'DELETE' });
            addToast('Success', `Service '${name}' deleted successfully`, 'success');
            loadServices();
        } catch (err: any) {
            addToast('Error', err.message || 'Failed to delete service', 'error');
        }
    };

    // COUNTER CRUD Events
    const handleCounterSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editCounterId) {
                await fetchWithAuth(`/api/admin/counters/${editCounterId}`, {
                    method: 'PATCH',
                    body: JSON.stringify(counterForm)
                });
                addToast('Success', 'Counter updated successfully', 'success');
            } else {
                await fetchWithAuth('/api/admin/counters', {
                    method: 'POST',
                    body: JSON.stringify(counterForm)
                });
                addToast('Success', 'Counter created successfully', 'success');
            }
            setShowCounterModal(false);
            setEditCounterId(null);
            setCounterForm({ name: '', service_id: '', status: 'CLOSED' });
            loadCounters();
        } catch (err: any) {
            addToast('Error', err.message || 'Operation failed', 'error');
        }
    };

    const handleEditCounter = (c: any) => {
        setEditCounterId(c.id);
        setCounterForm({ name: c.name, service_id: c.service_id, status: c.status });
        setShowCounterModal(true);
    };

    const handleDeleteCounter = async (id: string, name: string) => {
        if (!window.confirm(`Are you sure you want to delete counter ${name}?`)) return;
        try {
            await fetchWithAuth(`/api/admin/counters/${id}`, { method: 'DELETE' });
            addToast('Success', `Counter '${name}' has been deleted`, 'success');
            loadCounters();
        } catch (err: any) {
            addToast('Error', err.message || 'Failed to delete counter', 'error');
        }
    };

    // Handle counter staff assignments
    const handleAssignOperator = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!assignCounterId) return;

        try {
            await fetchWithAuth(`/api/admin/counters/${assignCounterId}/assign-staff`, {
                method: 'PATCH',
                body: JSON.stringify({ staffId: assignStaffId || null })
            });
            addToast('Success', 'Operator counter placement assignment updated', 'success');
            setAssignCounterId(null);
            setAssignStaffId('');
            loadCounters();
        } catch (err: any) {
            addToast('Error', err.message || 'Placement failed', 'error');
        }
    };

    // Format wait minutes
    const formatMins = (val: number) => `${Math.round(val * 10) / 10}m`;

    return (
        <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-dark)' }}>
            {/* Toast Notification Container */}
            <ToastNotification toasts={toasts} onDismiss={dismissToast} />

            {/* Responsive Collapsible Sidebar */}
            <AdminSidebar activeTab={activeTab} setActiveTab={setActiveTab} />

            {/* Main Panel Content */}
            <main style={{ flex: 1, padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto' }}>

                {/* Header Ribbon bar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                    <div>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                            {activeTab.replace('-', ' ')} PANEL
                        </h2>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            QueueCraft administration portal session.
                        </p>
                    </div>

                    <button
                        onClick={reloadActiveTabData}
                        disabled={loading}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
                    </button>
                </div>

                {error && (
                    <div style={{ color: 'var(--status-closed)', backgroundColor: 'rgba(244, 63, 94, 0.1)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(244, 63, 94, 0.3)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <ShieldAlert size={20} />
                        <span>{error}</span>
                    </div>
                )}

                {/* -------------------- UIs -------------------- */}

                {/* OVERVIEW PANEL */}
                {activeTab === 'overview' && dashboardStats && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {/* Stats widgets grid */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                            gap: '1rem'
                        }}>
                            <div className="qc-card" style={{ padding: '1.25rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Services</span>
                                    <Layers size={18} style={{ color: 'var(--accent-primary)' }} />
                                </div>
                                <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.5rem' }}>
                                    {dashboardStats.services_count}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>active service queues</div>
                            </div>

                            <div className="qc-card" style={{ padding: '1.25rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Active counters</span>
                                    <MonitorPlay size={18} style={{ color: 'var(--status-open)' }} />
                                </div>
                                <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--status-open)', marginTop: '0.5rem' }}>
                                    {dashboardStats.active_counters_count}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>open counters</div>
                            </div>

                            <div className="qc-card" style={{ padding: '1.25rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Tokens line</span>
                                    <Users size={18} style={{ color: '#fbbf24' }} />
                                </div>
                                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#fbbf24', marginTop: '0.5rem' }}>
                                    {dashboardStats.waiting_tokens_count}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>waiting in queue</div>
                            </div>

                            <div className="qc-card" style={{ padding: '1.25rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Serving now</span>
                                    <CircleDot size={18} style={{ color: 'var(--accent-secondary)' }} />
                                </div>
                                <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent-secondary)', marginTop: '0.5rem' }}>
                                    {dashboardStats.currently_serving_count}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>actively processing</div>
                            </div>
                        </div>

                        {/* Performance Card */}
                        <div className="qc-card" style={{ padding: '1.5rem' }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '1rem' }}>
                                AVERAGE WAITING TIME & COMPLETIONS TODAY
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem' }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)' }}>
                                        <Clock size={16} />
                                        <span style={{ fontSize: '0.85rem' }}>Average Waiting Time</span>
                                    </div>
                                    <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.5rem' }}>
                                        {formatMins(dashboardStats.avg_waiting_time_minutes)}
                                    </div>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                                        Average duration for checked-in tokens from booking to serving start.
                                    </p>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', justifyContent: 'center' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Completed Today</span>
                                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--status-open)' }}>{dashboardStats.completed_today_count} tokens</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Skipped Today</span>
                                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--status-busy)' }}>{dashboardStats.skipped_today_count} tokens</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0' }}>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Cancelled Today</span>
                                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--status-closed)' }}>{dashboardStats.cancelled_today_count} tokens</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* SERVICES MANAGEMENT */}
                {activeTab === 'services' && (
                    <div className="qc-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>SERVICES CONFIGURATION ({servicesList.length})</span>
                            <button
                                onClick={() => { setEditServiceId(null); setServiceForm({ name: '', code: '', description: '' }); setShowServiceModal(true); }}
                                className="btn btn-primary"
                                style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem' }}
                            >
                                <Plus size={14} /> Add Service
                            </button>
                        </div>

                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                                <thead>
                                    <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                        <th style={{ padding: '0.75rem' }}>SERVICE NAME</th>
                                        <th style={{ padding: '0.75rem' }}>PREFIX CODE</th>
                                        <th style={{ padding: '0.75rem' }}>DESCRIPTION</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'right' }}>ACTIONS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {servicesList.map((srv) => (
                                        <tr key={srv.id} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                            <td style={{ padding: '0.75rem', fontWeight: 700 }}>{srv.name}</td>
                                            <td style={{ padding: '0.75rem' }}><span className="badge badge-priority">{srv.code}</span></td>
                                            <td style={{ padding: '0.75rem', color: 'var(--text-secondary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{srv.description || '—'}</td>
                                            <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                                <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                                                    <button onClick={() => handleEditService(srv)} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem' }}>
                                                        <Edit2 size={12} />
                                                    </button>
                                                    <button onClick={() => handleDeleteService(srv.id, srv.name)} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', color: 'var(--status-closed)' }}>
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {servicesList.length === 0 && (
                                        <tr>
                                            <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No services config records.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* COUNTER MANAGEMENT */}
                {activeTab === 'counters' && (
                    <div className="qc-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>COUNTERS CONFIGURATION ({countersList.length})</span>
                            <button
                                onClick={() => { setEditCounterId(null); setCounterForm({ name: '', service_id: servicesList[0]?.id || '', status: 'CLOSED' }); setShowCounterModal(true); }}
                                className="btn btn-primary"
                                style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem' }}
                                disabled={servicesList.length === 0}
                            >
                                <Plus size={14} /> Add Counter Desk
                            </button>
                        </div>

                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                                <thead>
                                    <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                        <th style={{ padding: '0.75rem' }}>COUNTER PORT</th>
                                        <th style={{ padding: '0.75rem' }}>ASSIGNED SERVICE</th>
                                        <th style={{ padding: '0.75rem' }}>STATUS</th>
                                        <th style={{ padding: '0.75rem' }}>OPERATOR STAFF</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'right' }}>ACTIONS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {countersList.map((cntr) => (
                                        <tr key={cntr.id} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                            <td style={{ padding: '0.75rem', fontWeight: 700 }}>{cntr.name}</td>
                                            <td style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>{cntr.service_name} ({cntr.service_code})</td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <span className={`badge badge-${cntr.status.toLowerCase()}`}>
                                                    {cntr.status}
                                                </span>
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                {cntr.assigned_staff_name ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <span style={{ fontWeight: 600 }}>{cntr.assigned_staff_name}</span>
                                                        <button
                                                            onClick={() => { setAssignCounterId(cntr.id); setAssignStaffId(''); }}
                                                            className="btn btn-secondary"
                                                            style={{ padding: '0.15rem 0.35rem', fontSize: '0.65rem' }}
                                                            title="Reassign staff"
                                                        >
                                                            change
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Unassigned</span>
                                                        <button
                                                            onClick={() => { setAssignCounterId(cntr.id); setAssignStaffId(''); }}
                                                            className="btn btn-primary"
                                                            style={{ padding: '0.15rem 0.35rem', fontSize: '0.65rem' }}
                                                        >
                                                            Assign
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                                <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                                                    <button onClick={() => handleEditCounter(cntr)} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem' }}>
                                                        <Edit2 size={12} />
                                                    </button>
                                                    <button onClick={() => handleDeleteCounter(cntr.id, cntr.name)} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', color: 'var(--status-closed)' }}>
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {countersList.length === 0 && (
                                        <tr>
                                            <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No counters config records.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* STAFF/USER MANAGEMENT */}
                {activeTab === 'staff' && (
                    <div className="qc-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>OPERATORS & USERS LIST ({usersList.length})</span>
                            <button
                                onClick={() => { setEditUserId(null); setUserForm({ name: '', email: '', password: '', role: 'STAFF' }); setShowUserModal(true); }}
                                className="btn btn-primary"
                                style={{ fontSize: '0.8rem', padding: '0.5rem 0.75rem' }}
                            >
                                <Plus size={14} /> Add User
                            </button>
                        </div>

                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                                <thead>
                                    <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                        <th style={{ padding: '0.75rem' }}>OPERATOR NAME</th>
                                        <th style={{ padding: '0.75rem' }}>EMAIL ADDRESS</th>
                                        <th style={{ padding: '0.75rem' }}>ROLE</th>
                                        <th style={{ padding: '0.75rem' }}>CREATION STAMP</th>
                                        <th style={{ padding: '0.75rem', textAlign: 'right' }}>ACTIONS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {usersList.map((u) => (
                                        <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                            <td style={{ padding: '0.75rem', fontWeight: 700 }}>{u.name}</td>
                                            <td style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>{u.email}</td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <span className={`badge ${u.role === 'ADMIN' ? 'badge-priority' : u.role === 'STAFF' ? 'badge-open' : 'badge-closed'}`}>
                                                    {u.role}
                                                </span>
                                            </td>
                                            <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{new Date(u.created_at).toLocaleString()}</td>
                                            <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                                <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                                                    <button onClick={() => handleEditUser(u)} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem' }}>
                                                        <Edit2 size={12} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteUser(u.id, u.name)}
                                                        className="btn btn-secondary"
                                                        style={{ padding: '0.25rem 0.5rem', color: 'var(--status-closed)' }}
                                                        disabled={u.id === user?.id}
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* LIVE MONITOR */}
                {activeTab === 'live-monitor' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div className="qc-card" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <CircleDot size={18} style={{ color: 'var(--status-open)' }} />
                            <span style={{ fontSize: '0.85rem', fontWeight: 800 }}>LIVE SYSTEM MONITORING (Active Sockets Listening)</span>
                        </div>

                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                            gap: '1.25rem'
                        }}>
                            {liveMonitorData.map((mon) => {
                                const isOpen = mon.counter_status === 'OPEN';
                                return (
                                    <div
                                        key={mon.counter_id}
                                        className="qc-card"
                                        style={{
                                            padding: '1.25rem',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '0.875rem',
                                            borderLeft: `4px solid ${isOpen ? 'var(--status-open)' : 'var(--border-color)'}`
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <h4 style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)' }}>{mon.counter_name}</h4>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{mon.service_name} ({mon.service_code})</span>
                                            </div>
                                            <span className={`badge badge-${mon.counter_status.toLowerCase()}`}>{mon.counter_status}</span>
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', backgroundColor: 'var(--bg-dark)', padding: '0.75rem', borderRadius: 'var(--radius-md)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                                                <span style={{ color: 'var(--text-muted)' }}>Staff Operator:</span>
                                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{mon.assigned_staff?.name || 'Vacant'}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                                                <span style={{ color: 'var(--text-muted)' }}>Waiting Queue:</span>
                                                <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{mon.waiting_count} waiting</span>
                                            </div>
                                        </div>

                                        <div style={{ padding: '0.5rem 0 0 0' }}>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Now Serving</div>
                                            {mon.current_token ? (
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', fontWeight: 800, color: 'var(--status-open)' }}>
                                                        {mon.current_token.token_number}
                                                    </span>
                                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                                                        {mon.current_token.student_name}
                                                    </span>
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                                    No active token
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {liveMonitorData.length === 0 && (
                                <div className="qc-card" style={{ padding: '2rem', textAlign: 'center', gridColumn: '1 / -1', color: 'var(--text-secondary)' }}>
                                    No counters configured.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* HISTORICAL ANALYTICS */}
                {activeTab === 'analytics' && analyticsData && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {/* Aggregate Stats Cards */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                            gap: '1rem'
                        }}>
                            <div className="qc-card" style={{ padding: '1rem' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Created Tokens</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                                    {analyticsData.summary.total_created}
                                </div>
                            </div>
                            <div className="qc-card" style={{ padding: '1rem' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Completed Tokens</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--status-open)', marginTop: '0.25rem' }}>
                                    {analyticsData.summary.completed_count}
                                </div>
                            </div>
                            <div className="qc-card" style={{ padding: '1rem' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Skipped Tokens</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--status-busy)', marginTop: '0.25rem' }}>
                                    {analyticsData.summary.skipped_count}
                                </div>
                            </div>
                            <div className="qc-card" style={{ padding: '1rem' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Cancelled Tokens</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--status-closed)', marginTop: '0.25rem' }}>
                                    {analyticsData.summary.cancelled_count}
                                </div>
                            </div>
                            <div className="qc-card" style={{ padding: '1rem' }}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Avg Service Duration</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                                    {formatMins(analyticsData.summary.avg_service_minutes)}
                                </div>
                            </div>
                        </div>

                        {/* Custom Visual Charts Component */}
                        <AnalyticsCharts
                            summary={analyticsData.summary}
                            serviceDistribution={analyticsData.service_distribution}
                            counterActivity={analyticsData.counter_activity}
                            hourlyDistribution={analyticsData.hourly_distribution}
                        />
                    </div>
                )}

            </main>

            {/* -------------------- POPUP MODALS -------------------- */}

            {/* 1. Add/Edit User Modal */}
            {showUserModal && (
                <div className="modal-overlay" onClick={() => setShowUserModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '450px' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '1.25rem' }}>
                            {editUserId ? 'EDIT USER PROFILE' : 'NEW USER ACCOUNT'}
                        </h3>

                        <form onSubmit={handleUserSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Full Name</label>
                                <input
                                    type="text"
                                    required
                                    value={userForm.name}
                                    onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                                    placeholder="e.g. John Doe"
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '0.25rem', fontSize: '0.85rem' }}
                                />
                            </div>

                            <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Email Address</label>
                                <input
                                    type="email"
                                    required
                                    value={userForm.email}
                                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                                    placeholder="name@queuecraft.edu"
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '0.25rem', fontSize: '0.85rem' }}
                                />
                            </div>

                            <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                    {editUserId ? 'New Password (leave blank to keep unchanged)' : 'Password'}
                                </label>
                                <input
                                    type="password"
                                    required={!editUserId}
                                    value={userForm.password}
                                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                                    placeholder="••••••••"
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '0.25rem', fontSize: '0.85rem' }}
                                />
                            </div>

                            <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Role Privilege</label>
                                <select
                                    value={userForm.role}
                                    onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '0.25rem', fontSize: '0.85rem' }}
                                >
                                    <option value="STAFF">STAFF (Counter Operator)</option>
                                    <option value="STUDENT">STUDENT (Customer)</option>
                                    <option value="ADMIN">ADMIN (System Administrator)</option>
                                </select>
                            </div>

                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                                <button type="button" onClick={() => setShowUserModal(false)} className="btn btn-secondary">
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* 2. Add/Edit Service Modal */}
            {showServiceModal && (
                <div className="modal-overlay" onClick={() => setShowServiceModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '450px' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '1.25rem' }}>
                            {editServiceId ? 'EDIT SERVICE CONFIG' : 'CREATE SERVICE FIELD'}
                        </h3>

                        <form onSubmit={handleServiceSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Service Title Name</label>
                                <input
                                    type="text"
                                    required
                                    value={serviceForm.name}
                                    onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
                                    placeholder="e.g. Registrar Desk"
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '0.25rem', fontSize: '0.85rem' }}
                                />
                            </div>

                            <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Prefix Code Shortname</label>
                                <input
                                    type="text"
                                    required
                                    maxLength={5}
                                    value={serviceForm.code}
                                    onChange={(e) => setServiceForm({ ...serviceForm, code: e.target.value })}
                                    placeholder="e.g. REG"
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '0.25rem', fontSize: '0.85rem' }}
                                />
                            </div>

                            <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Service Description</label>
                                <textarea
                                    value={serviceForm.description}
                                    onChange={(e) => setServiceForm({ ...serviceForm, description: e.target.value })}
                                    placeholder="Enter details about this campus service station..."
                                    style={{ width: '100%', height: '80px', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '0.25rem', fontSize: '0.85rem', resize: 'vertical' }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                                <button type="button" onClick={() => setShowServiceModal(false)} className="btn btn-secondary">
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* 3. Add/Edit Counter Modal */}
            {showCounterModal && (
                <div className="modal-overlay" onClick={() => setShowCounterModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '450px' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '1.25rem' }}>
                            {editCounterId ? 'EDIT COUNTER STATION' : 'ADD COUNTER DESK SERVICE'}
                        </h3>

                        <form onSubmit={handleCounterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Counter Display Name</label>
                                <input
                                    type="text"
                                    required
                                    value={counterForm.name}
                                    onChange={(e) => setCounterForm({ ...counterForm, name: e.target.value })}
                                    placeholder="e.g. Counter Desk A"
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '0.25rem', fontSize: '0.85rem' }}
                                />
                            </div>

                            <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Mapped Service Queue</label>
                                <select
                                    value={counterForm.service_id}
                                    onChange={(e) => setCounterForm({ ...counterForm, service_id: e.target.value })}
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '0.25rem', fontSize: '0.85rem' }}
                                >
                                    {servicesList.map(s => (
                                        <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Initial status</label>
                                <select
                                    value={counterForm.status}
                                    onChange={(e) => setCounterForm({ ...counterForm, status: e.target.value })}
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '0.25rem', fontSize: '0.85rem' }}
                                >
                                    <option value="CLOSED">CLOSED</option>
                                    <option value="OPEN">OPEN</option>
                                    <option value="BUSY">BUSY</option>
                                    <option value="MAINTENANCE">MAINTENANCE</option>
                                </select>
                            </div>

                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                                <button type="button" onClick={() => setShowCounterModal(false)} className="btn btn-secondary">
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* 4. Operator Placement Assignment Modal */}
            {assignCounterId && (
                <div className="modal-overlay" onClick={() => setAssignCounterId(null)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '1.25rem' }}>
                            ASSIGN OPERATOR STAFF
                        </h3>

                        <form onSubmit={handleAssignOperator} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Select Staff operator</label>
                                <select
                                    value={assignStaffId}
                                    onChange={(e) => setAssignStaffId(e.target.value)}
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'var(--bg-dark)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', marginTop: '0.25rem', fontSize: '0.85rem' }}
                                >
                                    <option value="">-- Leave Unassigned (Vacant) --</option>
                                    {usersList.filter(u => u.role === 'STAFF').map(u => (
                                        <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                                    ))}
                                </select>
                            </div>

                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                                <button type="button" onClick={() => setAssignCounterId(null)} className="btn btn-secondary">
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    Confirm Assign
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
    );
};
export default AdminDashboardPage;
