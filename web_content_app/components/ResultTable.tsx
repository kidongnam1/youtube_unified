
import React, { useRef, useState, useEffect, memo } from 'react';
import { GeneratedAsset } from '../types';
import { downloadProjectZip } from '../utils/csvHelper';
import { downloadSrt } from '../services/srtService';
import { exportAssetsToZip } from '../services/exportService';

interface ResultTableProps {
  data: GeneratedAsset[];
  onRegenerateImage?: (index: number) => void;
  onUpgradeImage?: (index: number) => void;
  onExportVideo?: (enableSubtitles: boolean) => void;
  onGenerateAnimation?: (index: number) => void;  // 영상 변환 콜백
  isExporting?: boolean;
  animatingIndices?: Set<number>;  // 현재 영상 변환 중인 인덱스들
}

// 오디오 디코딩 함수 (컴포넌트 외부로 이동하여 재생성 방지)
async function decodeAudio(base64: string, ctx: AudioContext): Promise<AudioBuffer> {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  try {
    return await ctx.decodeAudioData(bytes.buffer.slice(0));
  } catch (e) {
    const dataInt16 = new Int16Array(bytes.buffer);
    const frameCount = dataInt16.length;
    const buffer = ctx.createBuffer(1, frameCount, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i] / 32768.0;
    }
    return buffer;
  }
}

// 이미지 Lazy Loading 컴포넌트 (Intersection Observer 사용)
const LazyImage: React.FC<{
  src: string;
  alt: string;
  className?: string;
}> = memo(({ src, alt, className }) => {
  const imgRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' } // 100px 전에 미리 로드
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={imgRef} className="w-full h-full">
      {isVisible ? (
        <img
          src={src}
          alt={alt}
          className={`${className} ${isLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
          onLoad={() => setIsLoaded(true)}
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full bg-slate-800 animate-pulse" />
      )}
    </div>
  );
});

LazyImage.displayName = 'LazyImage';

// 오디오 플레이어 메모이제이션 (props가 같으면 리렌더 방지)
const AudioPlayer: React.FC<{ base64: string }> = memo(({ base64 }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopAudio = () => {
    if (sourceRef.current) { try { sourceRef.current.stop(); } catch (e) {} sourceRef.current = null; }
    setIsPlaying(false);
  };

  const playAudio = async () => {
    if (isPlaying) { stopAudio(); return; }
    try {
      setIsPlaying(true);
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();
      
      const audioBuffer = await decodeAudio(base64, ctx);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => setIsPlaying(false);
      source.start();
      sourceRef.current = source;
    } catch (error) { console.error(error); setIsPlaying(false); }
  };

  return (
    <button onClick={playAudio} className={`p-2.5 rounded-full border transition-all ${isPlaying ? 'bg-brand-600 border-brand-500 text-white animate-pulse' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}>
      {isPlaying ? <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
    </button>
  );
});

AudioPlayer.displayName = 'AudioPlayer';

// 테이블 행 컴포넌트 (개별 행 메모이제이션으로 리렌더 최소화)
interface TableRowProps {
  row: GeneratedAsset;
  index: number;
  isAnimating: boolean;
  onRegenerateImage?: (index: number) => void;
  onGenerateAnimation?: (index: number) => void;
}

const TableRow: React.FC<TableRowProps> = memo(({ row, index, isAnimating, onRegenerateImage, onGenerateAnimation }) => {
  return (
    <tr className="group hover:bg-slate-800/20 transition-colors">
      <td className="py-5 px-6 align-top font-mono text-slate-600 text-[10px]">#{row.sceneNumber.toString().padStart(2, '0')}</td>
      <td className="py-5 px-6 align-top">
        <div className="space-y-3">
          <p className="text-slate-200 text-[11px] leading-relaxed font-medium tracking-tight">{row.narration}</p>
          {row.analysis?.composition_type && (
            <div className="flex flex-wrap gap-1">
              <span className={`text-[7px] font-black px-1.5 py-0.5 rounded border uppercase ${
                row.analysis.composition_type === 'MACRO' ? 'text-brand-400 bg-brand-400/5 border-brand-400/20' :
                row.analysis.composition_type === 'STANDARD' ? 'text-emerald-400 bg-emerald-400/5 border-emerald-400/20' :
                'text-amber-400 bg-amber-400/5 border-amber-400/20'
              }`}>{row.analysis.composition_type}</span>
              {row.analysis.sentiment && (
                <span className={`text-[7px] font-black px-1.5 py-0.5 rounded border uppercase ${
                  row.analysis.sentiment === 'POSITIVE' ? 'text-green-400 bg-green-400/5 border-green-400/20' :
                  row.analysis.sentiment === 'NEGATIVE' ? 'text-red-400 bg-red-400/5 border-red-400/20' :
                  'text-slate-400 bg-slate-400/5 border-slate-400/20'
                }`}>{row.analysis.sentiment}</span>
              )}
            </div>
          )}
        </div>
      </td>
      <td className="py-5 px-6 align-top">
        <div className="bg-slate-950/30 rounded-lg p-3 border border-slate-800/50 text-[9px] text-slate-600 font-mono leading-tight whitespace-pre-wrap">
          {row.visualPrompt}
        </div>
      </td>
      <td className="py-5 px-6 align-top">
        <div className="relative aspect-video w-48 mx-auto rounded-xl overflow-hidden bg-slate-950 border border-slate-800 shadow-inner group/img">
          {row.status === 'generating' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent animate-spin rounded-full"></div>
              <span className="text-[7px] text-brand-500 font-black uppercase tracking-widest">렌더링 중</span>
            </div>
          ) : isAnimating ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-cyan-950/30">
              <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent animate-spin rounded-full"></div>
              <span className="text-[7px] text-cyan-400 font-black uppercase tracking-widest">영상 변환 중</span>
            </div>
          ) : row.status === 'error' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-red-950/30 border-2 border-dashed border-red-800/50 m-2 rounded-lg">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-[8px] text-red-400 font-black uppercase">생성 실패</span>
              <button
                onClick={() => onRegenerateImage?.(index)}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[9px] font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-lg"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                다시 생성
              </button>
            </div>
          ) : row.videoData ? (
            <>
              <video src={row.videoData} className="w-full h-full object-cover" autoPlay loop muted playsInline />
              <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-cyan-500/80 text-[6px] font-black text-white uppercase">영상</div>
              <div className="absolute inset-0 bg-slate-950/80 opacity-0 group-hover/img:opacity-100 transition-all flex items-center justify-center gap-1.5">
                <button onClick={() => onRegenerateImage?.(index)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all" title="이미지 재생성">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
                <button onClick={() => onGenerateAnimation?.(index)} className="p-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/30 text-cyan-400 transition-all" title="영상 재생성">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
              </div>
            </>
          ) : row.imageData ? (
            <>
              <LazyImage
                src={`data:image/jpeg;base64,${row.imageData}`}
                alt="Scene"
                className="w-full h-full object-cover transition-transform group-hover/img:scale-105"
              />
              <div className="absolute inset-0 bg-slate-950/80 opacity-0 group-hover/img:opacity-100 transition-all flex items-center justify-center gap-1.5">
                <button onClick={() => onRegenerateImage?.(index)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all" title="이미지 재생성">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </button>
                <button onClick={() => onGenerateAnimation?.(index)} className="p-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/30 text-cyan-400 transition-all" title="영상 변환">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
              </div>
            </>
          ) : <div className="absolute inset-0 flex items-center justify-center border-2 border-dashed border-slate-800 m-2 rounded-lg"><span className="text-[7px] text-slate-700 font-black uppercase">대기 중</span></div>}
        </div>
      </td>
      <td className="py-5 px-6 align-top text-center">
        {row.audioData ? <div className="flex justify-center"><AudioPlayer base64={row.audioData} /></div> : <div className="flex flex-col items-center gap-1.5 opacity-30"><div className="w-2.5 h-2.5 border-2 border-slate-700 border-t-slate-500 animate-spin rounded-full"></div><span className="text-[6px] text-slate-600 font-black uppercase">VO</span></div>}
      </td>
    </tr>
  );
});

TableRow.displayName = 'TableRow';

const ResultTable: React.FC<ResultTableProps> = ({ data, onRegenerateImage, onExportVideo, onGenerateAnimation, isExporting, animatingIndices }) => {
  if (data.length === 0) return null;

  return (
    <div className="w-full max-w-[98%] mx-auto pb-32 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-6 bg-slate-900/90 backdrop-blur-md p-5 rounded-3xl border border-slate-800">
        <div className="flex items-center gap-4">
          <div className="w-1 h-10 bg-brand-500 rounded-full"></div>
          <div>
            <h2 className="text-xl font-black text-white tracking-tight">졸라맨 V10.0 마스터 스토리보드</h2>
            <p className="text-slate-500 text-[9px] font-bold uppercase tracking-widest">Ultra-Detail Identity Sync Active</p>
          </div>
        </div>
        <div className="flex gap-2">
            <button onClick={() => downloadProjectZip(data)} className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-bold text-[10px] hover:bg-slate-700 transition-all flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              전체 프로젝트 저장
            </button>
            <button onClick={() => exportAssetsToZip(data, `스토리보드_${new Date().toLocaleDateString('ko-KR')}`)} className="px-4 py-2.5 rounded-xl bg-emerald-800 border border-emerald-700 text-emerald-300 font-bold text-[10px] hover:bg-emerald-700 transition-all flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              엑셀+이미지 내보내기
            </button>
            <button onClick={async () => await downloadSrt(data, `subtitles_${Date.now()}.srt`)} className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-bold text-[10px] hover:bg-slate-700 transition-all flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              SRT 자막 다운로드
            </button>
            <button onClick={() => onExportVideo?.(false)} disabled={isExporting} className={`px-5 py-2.5 rounded-xl transition-all font-black text-[10px] flex items-center justify-center gap-2 ${isExporting ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-slate-700 text-white hover:bg-slate-600 border border-slate-600'}`}>
                {isExporting ? <div className="w-3 h-3 border-2 border-slate-500 border-t-transparent animate-spin rounded-full"></div> : <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
                MP4 (자막 X)
            </button>
            <button onClick={() => onExportVideo?.(true)} disabled={isExporting} className={`px-5 py-2.5 rounded-xl transition-all font-black text-[10px] flex items-center justify-center gap-2 ${isExporting ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-brand-600 text-white hover:bg-brand-500 shadow-lg shadow-brand-900/20'}`}>
                {isExporting ? <div className="w-3 h-3 border-2 border-slate-500 border-t-transparent animate-spin rounded-full"></div> : <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
                MP4 (자막 O)
            </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/20 backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1200px] table-fixed">
            <thead className="bg-slate-900/80 border-b border-slate-800">
              <tr>
                <th className="py-4 px-6 text-[9px] font-black text-slate-500 uppercase tracking-widest w-16">번호</th>
                <th className="py-4 px-6 text-[9px] font-black text-slate-500 uppercase tracking-widest w-[30%]">나레이션 / CEO 프로토콜</th>
                <th className="py-4 px-6 text-[9px] font-black text-slate-500 uppercase tracking-widest w-[30%]">V9.2 통합 영문 프롬프트</th>
                <th className="py-4 px-6 text-[9px] font-black text-slate-500 uppercase tracking-widest w-56 text-center">생성 결과물</th>
                <th className="py-4 px-6 text-[9px] font-black text-slate-500 uppercase tracking-widest w-20 text-center">음성</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {data.map((row, index) => (
                <TableRow
                  key={row.sceneNumber}
                  row={row}
                  index={index}
                  isAnimating={animatingIndices?.has(index) || false}
                  onRegenerateImage={onRegenerateImage}
                  onGenerateAnimation={onGenerateAnimation}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ResultTable;
