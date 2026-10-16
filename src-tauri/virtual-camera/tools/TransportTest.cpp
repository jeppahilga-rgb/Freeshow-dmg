#include <windows.h>
#include <vector>
#include <cassert>
#include <cstdio>
#include "../FrameTransport.h"
int wmain(){
    WCHAR directory[MAX_PATH],path[MAX_PATH];GetTempPathW(MAX_PATH,directory);GetTempFileNameW(directory,L"fsc",0,path);
    HANDLE file=CreateFileW(path,GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,0,nullptr);
    constexpr size_t size=64+1280*720*4*2;
    HANDLE mapping=CreateFileMappingW(file,nullptr,PAGE_READWRITE,0,(DWORD)size,nullptr);
    BYTE* view=(BYTE*)MapViewOfFile(mapping,FILE_MAP_ALL_ACCESS,0,0,size);assert(view);
    auto header=(FreeShowFrameHeader*)view;ZeroMemory(view,size);
    header->magic=0x4653434D;header->version=1;header->width=1280;header->height=720;header->active=1;header->heartbeat=GetTickCount64();header->sequence[0]=2;
    for(size_t pixel=0;pixel<1280*720;pixel++){view[64+pixel*4]=255;view[64+pixel*4+3]=255;}
    {
        FreeShowFrameReader reader(path);std::vector<BYTE> output(640*360*4);
        assert(reader.copy(output.data(),640,360,640*4));assert(output[0]==255&&output[1]==0&&output[2]==0&&output.back()==255);
        header->sequence[0]=3;assert(!reader.copy(output.data(),640,360,640*4));header->sequence[0]=4;
        header->active=0;assert(!reader.copy(output.data(),640,360,640*4));header->active=1;
        header->heartbeat=GetTickCount64()-3000;assert(!reader.copy(output.data(),640,360,640*4));
    }
    UnmapViewOfFile(view);CloseHandle(mapping);CloseHandle(file);DeleteFileW(path);puts("Transport tests passed: color, scaling, incomplete write, inactive and stale frames.");
}
