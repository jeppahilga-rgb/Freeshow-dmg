#pragma once
#include <string>
// FreeShow's file-backed double buffer is shared with Windows Frame Server.
// A file mapping works across its service session without a privileged global
// mapping. Per-slot sequence counters reject frames overwritten during a read.
struct FreeShowFrameHeader {
    DWORD magic, version, width, height;
    volatile DWORD index, active, sequence[2];
    volatile ULONGLONG heartbeat;
    BYTE reserved[24];
};
static_assert(sizeof(FreeShowFrameHeader)==64);
class FreeShowFrameReader {
    std::wstring overridePath;
    HANDLE file=INVALID_HANDLE_VALUE, mapping=nullptr;
    BYTE* view=nullptr;
public:
    explicit FreeShowFrameReader(const wchar_t* path=nullptr):overridePath(path?path:L""){}
    ~FreeShowFrameReader(){if(view)UnmapViewOfFile(view);if(mapping)CloseHandle(mapping);if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);}
    bool copy(BYTE* dest, DWORD width, DWORD height, LONG pitch) {
        if(!view){
            WCHAR path[MAX_PATH];
            if(overridePath.empty()){if(!ExpandEnvironmentStringsW(L"%ProgramData%\\FreeShowVirtualCamera\\frame.bin",path,MAX_PATH))return false;}
            else if(wcscpy_s(path,overridePath.c_str())!=0)return false;
            file=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,0,nullptr);
            if(file==INVALID_HANDLE_VALUE)return false;
            mapping=CreateFileMappingW(file,nullptr,PAGE_READONLY,0,0,nullptr);
            if(!mapping){CloseHandle(file);file=INVALID_HANDLE_VALUE;return false;}
            view=(BYTE*)MapViewOfFile(mapping,FILE_MAP_READ,0,0,64+1280*720*4*2);
            if(!view){CloseHandle(mapping);mapping=nullptr;CloseHandle(file);file=INVALID_HANDLE_VALUE;return false;}
        }
        auto header=(FreeShowFrameHeader*)view;
        if(header->magic!=0x4653434D||header->version!=1||header->width!=1280||header->height!=720||!header->active||GetTickCount64()-header->heartbeat>2000)return false;
        const DWORD index=header->index&1, sequence=header->sequence[index];
        if(sequence&1)return false;
        MemoryBarrier();
        const BYTE* pixels=view+64+index*1280*720*4;
        for(DWORD y=0;y<height;y++){
            BYTE* row=dest+y*pitch;
            const BYTE* source=pixels+(size_t)(y*720/height)*1280*4;
            if(width==1280)memcpy(row,source,1280*4);
            else for(DWORD x=0;x<width;x++)memcpy(row+x*4,source+(x*1280/width)*4,4);
        }
        MemoryBarrier();
        return sequence==header->sequence[index];
    }
};
