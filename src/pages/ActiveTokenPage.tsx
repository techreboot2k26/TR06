import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { StudentHeader } from '../components/student/StudentHeader';
import { TokenStatusBadge } from '../components/student/TokenStatusBadge';
import { Users, Clock, AlertCircle, XCircle } from 'lucide-react';
import { useSocket } from '../context/SocketContext';

export const ActiveTokenPage: React.FC = () => {
  const { tokenId } = useParams();
  const navigate = useNavigate();
  const [token, setToken] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const { socket } = useSocket();

  const fetchActiveToken = async () => {
    try {
      const authToken = localStorage.getItem('qc_token');
      const res = await fetch('/api/student/tokens/active', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) throw new Error('Failed to fetch token');
      const data = await res.json();
      
      if (!data.token) {
        // If there's no active token, redirect to dashboard or history based on params
        navigate('/student/history');
      } else if (tokenId && data.token.id !== tokenId) {
        // Mismatch, redirect to actual active token
        navigate(`/student/token/${data.token.id}`);
      } else {
        setToken(data.token);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActiveToken();
  }, [tokenId]);

  // Socket listener for real-time queue updates (#6)
  useEffect(() => {
    if (!socket || !token?.counter_id) return;

    // Re-fetch queue position when anyone's token changes in this counter
    const handleQueueUpdate = (data: { counterId: string }) => {
      if (data.counterId === token.counter_id) {
        fetchActiveToken();
      }
    };

    // When this student's token is called to the counter
    const handleTokenCalled = (data: { counterId: string; token?: { id: string } }) => {
      const calledTokenId = data.token?.id || (data as any).id;
      if (calledTokenId === token.id || data.counterId === token.counter_id) {
        fetchActiveToken();
      }
    };

    // When a token is cancelled — if it's THIS student's token, navigate away
    const handleTokenCancelled = (data: { tokenId: string; counterId: string }) => {
      if (data.tokenId === token.id) {
        navigate('/student/history');
      } else if (data.counterId === token.counter_id) {
        // Someone else cancelled — update queue position
        fetchActiveToken();
      }
    };

    // Use correct server event names (QUEUE_UPDATED not queueUpdate)
    socket.on('QUEUE_UPDATED', handleQueueUpdate);
    socket.on('TOKEN_CALLED', handleTokenCalled);
    socket.on('TOKEN_CANCELLED', handleTokenCancelled);
    return () => {
      socket.off('QUEUE_UPDATED', handleQueueUpdate);
      socket.off('TOKEN_CALLED', handleTokenCalled);
      socket.off('TOKEN_CANCELLED', handleTokenCancelled);
    };
  }, [socket, token?.id, token?.counter_id]);

  const handleCancel = async () => {
    if (!window.confirm('Are you sure you want to cancel your queue position?')) return;
    
    setCancelling(true);
    try {
      const authToken = localStorage.getItem('qc_token');
      const res = await fetch(`/api/student/tokens/${token.id}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (!res.ok) throw new Error('Failed to cancel token');
      
      navigate('/student/history');
    } catch (err: any) {
      alert(err.message);
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-dark)' }}>
        <StudentHeader />
        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>Loading token details...</div>
      </div>
    );
  }

  if (error || !token) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-dark)' }}>
        <StudentHeader />
        <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '0 1.5rem' }}>
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '1rem', borderRadius: 'var(--radius-md)', color: '#ef4444', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <AlertCircle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Error</strong>
              <span style={{ fontSize: '0.875rem' }}>{error || 'Token not found'}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-dark)' }}>
      <StudentHeader />
      
      <main style={{ maxWidth: '600px', margin: '0 auto', padding: '2rem 1.5rem' }}>
        <div style={{ 
          backgroundColor: 'var(--bg-card)', 
          borderRadius: 'var(--radius-lg)', 
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-md)',
          overflow: 'hidden'
        }}>
          {/* Header */}
          <div style={{ 
            padding: '2rem', 
            textAlign: 'center', 
            borderBottom: '1px solid var(--border-color)',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%)'
          }}>
            <h2 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              Your Token
            </h2>
            <div style={{ fontSize: '3.5rem', fontWeight: 800, color: 'var(--accent-primary)', letterSpacing: '-0.02em', lineHeight: 1, marginBottom: '1rem' }}>
              {token.token_number}
            </div>
            <TokenStatusBadge status={token.status} size="lg" />
          </div>

          {/* Details */}
          <div style={{ padding: '2rem' }}>
            <div style={{ display: 'grid', gap: '1.5rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Service & Counter</span>
                <div style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                  {token.service_name}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  {token.counter_name}
                </div>
              </div>

              {token.status === 'WAITING' && (
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: '1fr 1fr', 
                  gap: '1rem',
                  backgroundColor: 'var(--bg-dark)',
                  padding: '1.25rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                      <Users size={16} />
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Ahead of You</span>
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {token.people_ahead}
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                      <Clock size={16} />
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Est. Wait</span>
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {token.estimated_wait_time} <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 600 }}>min</span>
                    </div>
                  </div>
                </div>
              )}

              {token.status === 'SERVING' && (
                <div style={{ 
                  backgroundColor: 'rgba(16, 185, 129, 0.1)', 
                  padding: '1.5rem', 
                  borderRadius: 'var(--radius-md)', 
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                  textAlign: 'center'
                }}>
                  <strong style={{ color: '#34d399', fontSize: '1.125rem', display: 'block', marginBottom: '0.5rem' }}>It's your turn!</strong>
                  <span style={{ color: 'var(--text-primary)', fontSize: '0.875rem' }}>Please proceed to {token.counter_name}.</span>
                </div>
              )}

              {token.status === 'HELD' && (
                <div style={{ 
                  backgroundColor: 'rgba(245, 158, 11, 0.1)', 
                  padding: '1.5rem', 
                  borderRadius: 'var(--radius-md)', 
                  border: '1px solid rgba(245, 158, 11, 0.2)',
                  textAlign: 'center'
                }}>
                  <strong style={{ color: '#fbbf24', fontSize: '1.125rem', display: 'block', marginBottom: '0.5rem' }}>Token Held</strong>
                  <span style={{ color: 'var(--text-primary)', fontSize: '0.875rem' }}>Your token is currently on hold. Please wait for the staff to call you again.</span>
                </div>
              )}

              {/* Cancel Button */}
              {(token.status === 'WAITING' || token.status === 'HELD') && (
                <button 
                  onClick={handleCancel}
                  disabled={cancelling}
                  style={{ 
                    marginTop: '1rem',
                    width: '100%',
                    padding: '0.875rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    backgroundColor: 'transparent',
                    color: '#ef4444',
                    fontWeight: 600,
                    fontSize: '0.875rem',
                    cursor: cancelling ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                     e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                  }}
                  onMouseOut={(e) => {
                     e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <XCircle size={18} /> {cancelling ? 'Cancelling...' : 'Cancel Token'}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
