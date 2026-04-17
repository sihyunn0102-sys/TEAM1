"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";

// 1. [수정] 의약외품 제거 및 카테고리 구성
const categories = [
  {
    id: "general",
    label: "일반화장품",
    desc: "스킨케어 · 메이크업 · 헤어",
    icon: "🧴",
    productType: "general_cosmetic",
  },
  {
    id: "functional",
    label: "기능성화장품",
    desc: "미백 · 주름 · 자외선차단",
    icon: "✨",
    productType: "functional_cosmetic",
  },
];

function Stepper({ current }: { current: number }) {
  const steps = ["제품 유형 선택", "내용 입력", "분석 시작"];

  return (
    <div className="flex items-center justify-center gap-0 mb-10">
      {steps.map((label, i) => {
        const idx = i + 1;
        const isDone = current > idx;
        const isActive = current === idx;

        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-200
                  ${
                    isDone
                      ? "bg-blue-600 text-white"
                      : isActive
                        ? "bg-blue-600 text-white ring-4 ring-blue-100"
                        : "bg-gray-100 text-gray-400"
                  }`}
              >
                {isDone ? "✓" : idx}
              </div>

              <span
                className={`mt-1.5 text-xs font-medium whitespace-nowrap ${
                  isActive || isDone ? "text-blue-600" : "text-gray-400"
                }`}
              >
                {label}
              </span>
            </div>

            {i < steps.length - 1 && (
              <div
                className={`w-20 h-0.5 mb-5 mx-1 transition-all duration-200 ${
                  current > idx ? "bg-blue-600" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAgreed, setIsAgreed] = useState(false); // 3. 동의 체크박스 상태

  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");

  // 5-1. [추가] 텍스트 영역 동적 높이 조절
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(280, textareaRef.current.scrollHeight)}px`;
    }
  }, [text]);

  const validateFile = (targetFile: File) => {
    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
    if (!allowedTypes.includes(targetFile.type)) {
      alert("PNG, JPG, JPEG, PDF 파일만 업로드 가능합니다.");
      return false;
    }
    return true;
  };

  const handleFileSelect = (targetFile: File | null) => {
    if (!targetFile) return;
    if (!validateFile(targetFile)) return;

    setFile(targetFile);
    // 5-2. [추가] 이미지 미리보기 URL 생성
    if (targetFile.type.startsWith("image/")) {
      const url = URL.createObjectURL(targetFile);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      handleFileSelect(dropped);
    }
  };

  const analyzeOCR = async (targetFile: File) => {
    setLoadingStatus("이미지에서 텍스트를 추출하고 있습니다...");
    const formData = new FormData();
    formData.append("file", targetFile);

    const response = await fetch("/api/ocr", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "OCR 요청 실패");
    return data.text as string;
  };

  const handleAnalyze = async () => {
    if (!selectedCategory) { alert("제품 유형을 선택하세요."); return; }
    if (!text.trim() && !file) { alert("텍스트를 입력하거나 파일을 업로드하세요."); return; }
    if (!isAgreed) { alert("데이터 처리에 동의해주세요."); return; }

    setLoading(true);

    try {
      let finalContent = text.trim();

      // 2. [수정] 파일이 있으면 OCR 텍스트를 추출하여 기존 텍스트와 합침
      if (file) {
        const ocrText = await analyzeOCR(file);
        finalContent = text.trim() 
          ? `${text.trim()}\n\n[이미지 추출 내용]\n${ocrText}`
          : ocrText;
      }

      setLoadingStatus("표시광고법 위반 여부를 분석 중입니다...");
      const category = categories.find((c) => c.id === selectedCategory);
      const productType = category?.productType ?? "general_cosmetic";

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: finalContent, product_type: productType }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "분석 요청 실패");

      localStorage.setItem("adguard_result", JSON.stringify(data));
      router.push("/result");
    } catch (error) {
      console.error(error);
      alert("분석 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setLoading(false);
      setLoadingStatus("");
    }
  };

  const isReady = !!selectedCategory && (!!text.trim() || !!file) && isAgreed;
  const currentStep = !selectedCategory ? 1 : !(text.trim() || file) ? 2 : 3;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-5xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white border border-gray-200 text-xs text-gray-400 mb-5 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Azure AI 기반 광고 컴플라이언스 도구
          </div>
          <h1 className="text-4xl font-extrabold text-gray-900 mb-2 tracking-tight">광고청정기</h1>
          <p className="text-gray-500 text-base">광고 문구와 이미지를 동시에 분석하여 위반 여부를 확인해 드립니다.</p>
        </div>

        <Stepper current={currentStep} />

        <div className="bg-white rounded-[40px] shadow-sm border border-gray-100 p-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {/* 좌측 영역 */}
            <div className="space-y-8 flex flex-col">
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-4">제품 유형 선택 <span className="text-blue-500">*</span></p>
                <div className="grid grid-cols-1 gap-3">
                  {categories.map((cat) => {
                    const isSelected = selectedCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`p-5 rounded-2xl border-2 text-left transition-all duration-150 flex items-center gap-4 group
                          ${isSelected ? "border-blue-500 bg-blue-50" : "border-gray-100 hover:border-blue-200 hover:bg-blue-50/40"}`}
                      >
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all duration-150
                            ${isSelected ? "bg-blue-100" : "bg-gray-100 group-hover:bg-blue-100"}`}>{cat.icon}</div>
                        <div className="flex-1">
                          <div className={`text-sm font-bold transition-colors ${isSelected ? "text-blue-700" : "text-gray-800"}`}>{cat.label}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{cat.desc}</div>
                        </div>
                        {isSelected && <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">✓</div>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. [수정] 텍스트 입력 파트 확장 (flex-1 적용) */}
              <div className="flex-1 flex flex-col">
                <p className="text-sm font-semibold text-gray-700 mb-4">텍스트 직접 입력</p>
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="광고 문구를 입력하세요&#10;예) 단 1회만에 피부 30% 개선 보장!"
                  className="w-full flex-1 p-5 rounded-2xl bg-gray-50 border border-gray-100 text-sm transition-all resize-none focus:outline-none focus:border-blue-400 focus:bg-white text-gray-700 leading-relaxed"
                />
              </div>
            </div>

            {/* 우측 영역 */}
            <div className="flex flex-col gap-8">
              <div className="flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold text-gray-700">파일 업로드</p>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">PNG · JPG · PDF</span>
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  // 5-3. [추가] 드래그 앤 드롭 애니메이션 및 스타일
                  className={`relative flex-1 rounded-[32px] border-2 border-dashed flex flex-col items-center justify-center transition-all duration-300 cursor-pointer overflow-hidden
                    ${isDragging ? "border-blue-500 bg-blue-50 scale-[1.02]" : file ? "border-blue-300 bg-white" : "border-gray-200 bg-gray-50 hover:bg-gray-100"}`}
                >
                  <input ref={fileInputRef} type="file" className="hidden" accept=".png,.jpg,.jpeg,.pdf" onChange={(e) => handleFileSelect(e.target.files?.[0] || null)} />

                  {file ? (
                    <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center p-4">
                      {/* 5-2. [추가] 이미지 썸네일 미리보기 */}
                      {previewUrl ? (
                        <div className="relative w-full h-full group">
                          <img src={previewUrl} alt="Preview" className="w-full h-full object-contain rounded-xl" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                            <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); setPreviewUrl(null); }} className="bg-white text-red-500 p-2 rounded-full shadow-lg hover:scale-110 transition-transform font-bold text-xs">삭제</button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center space-y-3">
                          <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center text-4xl mx-auto">📋</div>
                          <p className="text-sm text-gray-700 font-semibold truncate max-w-[200px]">{file.name}</p>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-xs text-red-500 underline">삭제</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center space-y-4 px-6">
                      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mx-auto transition-colors ${isDragging ? "bg-blue-600 text-white" : "bg-white shadow-sm text-gray-400"}`}>
                        {isDragging ? "↓" : "↑"}
                      </div>
                      <div>
                        <p className="text-sm text-gray-600 font-bold">이미지 · PDF 드래그 또는 클릭</p>
                        <p className="text-xs text-gray-400 mt-1">파일을 여기에 끌어다 놓으세요</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 하단 제어 및 동의 섹션 */}
              <div className="space-y-6">
                {/* 3. [수정] 필수 동의 체크박스 추가 */}
                <div 
                  className={`p-5 rounded-2xl border transition-all flex items-start gap-3 cursor-pointer ${isAgreed ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-100"}`}
                  onClick={() => setIsAgreed(!isAgreed)}
                >
                  <div className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center transition-all ${isAgreed ? "bg-blue-600 border-blue-600" : "bg-white border-gray-300"}`}>
                    {isAgreed && <span className="text-white text-[10px]">✓</span>}
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold text-gray-900 mb-1"><span className="text-blue-600">[필수]</span> 데이터 보안 및 처리 동의</p>
                    <p className="text-[10px] text-gray-400 leading-relaxed">분석에 사용된 데이터는 서비스 종료 시 즉시 파기되며, AI 학습용으로 활용되지 않음에 동의합니다.</p>
                  </div>
                </div>

                <div className="flex items-start gap-2 px-3 py-1">
                  <span className="text-xs opacity-60">⚠️</span>
                  <p className="text-[10px] text-gray-400 leading-relaxed">분석 데이터는 Azure AI를 통해 처리되며 법적 효력이 없습니다.</p>
                </div>

                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={!isReady || loading}
                  className={`w-full py-5 rounded-2xl text-base font-black transition-all duration-200 flex items-center justify-center gap-2 shadow-lg
                    ${isReady && !loading ? "bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]" : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"}`}
                >
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      {loadingStatus}
                    </>
                  ) : (
                    "광고 분석 시작 →"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}