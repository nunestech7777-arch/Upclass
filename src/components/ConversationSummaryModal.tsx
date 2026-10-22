import React, { useState } from 'react';
import { 
  X, 
  MessageSquareText, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  TrendingUp, 
  Sparkles, 
  User, 
  ShoppingBag, 
  ThumbsUp, 
  AlertCircle,
  FileText,
  DollarSign,
  ArrowRight
} from 'lucide-react';
import type { TranscriptMessage } from '../lib/transcript';
import './ConversationSummaryModal.css';

export type ChatMessage = TranscriptMessage;

export interface ConversationData {
  id: string;
  client: string;
  date: string;
  product: string;
  result: string;
  resultType: 'success' | 'loss' | 'open';
  seller: string;
  summary: string;
  keyPoints: string[];
  metrics: {
    duration: string;
    messagesCount: number;
    sentiment: string;
    score: string;
    objectionsCount: string;
  };
  aiAnalysis: {
    strengths: string[];
    improvements: string[];
  };
  chatHistory: ChatMessage[];
}

interface ConversationSummaryModalProps {
  conversation: ConversationData | null;
  onClose: () => void;
}

export function ConversationSummaryModal({ conversation, onClose }: ConversationSummaryModalProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'analysis'>('summary');

  if (!conversation) return null;

  const { resultType } = conversation;
  const statusIcon = resultType === 'success' ? <CheckCircle2 size={14} /> : resultType === 'loss' ? <XCircle size={14} /> : <Clock size={14} />;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <div className={`modal-icon-badge ${resultType}`}>
              <MessageSquareText size={20} />
            </div>
            <div>
              <div className="modal-pretitle">Relatório Detalhado de Atendimento</div>
              <h2 className="modal-title">{conversation.client}</h2>
              <div className="modal-subtitle">
                <span>{conversation.date}</span>
                <span className="dot-divider">•</span>
                <span>{conversation.product}</span>
                <span className="dot-divider">•</span>
                <span>Vendedor: <strong>{conversation.seller}</strong></span>
              </div>
            </div>
          </div>

          <div className="modal-header-actions">
            <span className={`status-pill status-${resultType}`}>
              {statusIcon}
              {conversation.result}
            </span>
            <button className="modal-close-btn" onClick={onClose} aria-label="Fechar modal">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Quick Metrics Bar */}
        <div className="metrics-bar">
          <div className="metric-item">
            <Clock size={16} className="metric-icon" />
            <div className="metric-content">
              <span className="metric-label">Duração</span>
              <span className="metric-value">{conversation.metrics.duration}</span>
            </div>
          </div>

          <div className="metric-item">
            <MessageSquareText size={16} className="metric-icon" />
            <div className="metric-content">
              <span className="metric-label">Mensagens</span>
              <span className="metric-value">{conversation.metrics.messagesCount} trocadas</span>
            </div>
          </div>

          <div className="metric-item">
            <ThumbsUp size={16} className="metric-icon" />
            <div className="metric-content">
              <span className="metric-label">Sentimento</span>
              <span className="metric-value">{conversation.metrics.sentiment}</span>
            </div>
          </div>

          <div className="metric-item highlight-metric">
            <Sparkles size={16} className="metric-icon" />
            <div className="metric-content">
              <span className="metric-label">Nota IA (Atendimento)</span>
              <span className="metric-value">{conversation.metrics.score}</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="modal-tabs">
          <button 
            className={`tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
            onClick={() => setActiveTab('summary')}
          >
            <FileText size={16} /> Pontos da Conversa & Resumo
          </button>
          <button 
            className={`tab-btn ${activeTab === 'transcript' ? 'active' : ''}`}
            onClick={() => setActiveTab('transcript')}
          >
            <MessageSquareText size={16} /> Transcrição Completa ({conversation.chatHistory.length})
          </button>
          <button 
            className={`tab-btn ${activeTab === 'analysis' ? 'active' : ''}`}
            onClick={() => setActiveTab('analysis')}
          >
            <Sparkles size={16} /> Análise & Feedback IA
          </button>
        </div>

        {/* Tab Contents */}
        <div className="modal-body">
          {activeTab === 'summary' && (
            <div className="tab-content flex-col gap-6">
              
              {/* Executive Summary Card */}
              <div className="summary-box">
                <div className="summary-box-title flex-center gap-2" style={{justifyContent: 'flex-start'}}>
                  <FileText size={18} color="var(--accent-text)" />
                  <h3>Resumo Executivo da Interação</h3>
                </div>
                <p className="summary-box-text">{conversation.summary}</p>
              </div>

              {/* Key Conversation Points Section */}
              <div className="key-points-container">
                <h3 className="section-heading flex-center gap-2" style={{justifyContent: 'flex-start'}}>
                  <Sparkles size={18} color="var(--accent-text)" />
                  Principais Pontos da Conversa
                </h3>
                
                <div className="key-points-list">
                  {conversation.keyPoints.map((point, idx) => (
                    <div key={idx} className="key-point-card">
                      <div className="key-point-bullet">
                        <ArrowRight size={14} color="var(--accent-text)" />
                      </div>
                      <div 
                        className="key-point-content"
                        dangerouslySetInnerHTML={{ 
                          __html: point.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') 
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Summary Grid */}
              <div className="summary-details-grid">
                <div className="detail-card">
                  <span className="detail-card-title"><ShoppingBag size={15} /> Produto de Interesse</span>
                  <span className="detail-card-value">{conversation.product}</span>
                </div>
                <div className="detail-card">
                  <span className="detail-card-title"><AlertCircle size={15} /> Objeção / Desafio</span>
                  <span className="detail-card-value">{conversation.metrics.objectionsCount}</span>
                </div>
              </div>

            </div>
          )}

          {activeTab === 'transcript' && (
            <div className="tab-content">
              <div className="chat-container">
                <div className="chat-info-banner">
                  <span>💬 Histórico completo de mensagens registradas durante o atendimento</span>
                </div>
                
                <div className="chat-messages-list">
                  {conversation.chatHistory.length === 0 && (
                    <div className="chat-empty-state">Nenhuma mensagem registrada para esta conversa.</div>
                  )}
                  {conversation.chatHistory.map((msg) => (
                    <React.Fragment key={msg.id}>
                      {msg.dayLabel && <div className="chat-day-divider">{msg.dayLabel}</div>}
                      <div className={`chat-bubble-wrapper ${msg.sender}-msg ${msg.sender === 'client' ? 'client-side' : 'company-side'}`}>
                        <div className="chat-sender-name">
                          {msg.senderName}
                          <span className="chat-msg-time">{msg.time}</span>
                        </div>
                        <div className={`chat-bubble ${msg.unavailable ? 'chat-bubble-unavailable' : ''}`}>
                          {msg.unavailable ? (
                            'Conteúdo não disponível pela API da Kommo'
                          ) : (
                            <>
                              {msg.attachmentType && <span className="chat-attachment-tag">[{msg.attachmentType}]</span>}
                              {msg.text}
                            </>
                          )}
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'analysis' && (
            <div className="tab-content flex-col gap-6">
              <div className="analysis-grid">
                
                {/* Strengths Card */}
                <div className="analysis-card strengths">
                  <div className="analysis-card-header">
                    <CheckCircle2 size={18} color="var(--success)" />
                    <h4>Pontos Fortes do Atendimento</h4>
                  </div>
                  <ul>
                    {conversation.aiAnalysis.strengths.map((item, idx) => (
                      <li key={idx}>
                        <CheckCircle2 size={14} color="var(--success)" style={{minWidth: '14px', marginTop: '3px'}} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Opportunities for Improvement */}
                <div className="analysis-card improvements">
                  <div className="analysis-card-header">
                    <TrendingUp size={18} color="var(--warning)" />
                    <h4>Oportunidades de Melhoria</h4>
                  </div>
                  <ul>
                    {conversation.aiAnalysis.improvements.map((item, idx) => (
                      <li key={idx}>
                        <AlertCircle size={14} color="var(--warning)" style={{minWidth: '14px', marginTop: '3px'}} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

              </div>

              {/* AI Coaching Tip */}
              {resultType !== 'open' && (
                <div className="coaching-banner">
                  <div className="coaching-icon">💡</div>
                  <div>
                    <strong>Dica da IA para o Vendedor:</strong>
                    <p>
                      {resultType === 'success'
                        ? 'Ótima condução de venda! Continue incentivando o fechamento rápido oferecendo entrega no mesmo dia e combos promocionais de acessórios.'
                        : 'Em objeções de preço por e-commerce, ressalte o custo do frete, tempo de espera e ofereça imediatamente um benefício exclusivo em loja para salvar a venda.'
                      }
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Fechar Relatório
          </button>
        </div>

      </div>
    </div>
  );
}
