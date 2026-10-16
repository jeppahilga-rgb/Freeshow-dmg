#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mfvirtualcamera.h>
#include <wrl/client.h>
#include <cstdio>
using Microsoft::WRL::ComPtr;
const wchar_t* sourceId=L"{48323401-52A7-4CD0-92B4-684B62D1FAE9}";
int wmain(int argc,wchar_t** argv){
    HRESULT hr=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
    if(FAILED(hr))return 1;
    hr=MFStartup(MF_VERSION);
    if(FAILED(hr))return 1;
    if(argc==3&&wcscmp(argv[1],L"--probe")==0){
        auto module=LoadLibraryW(argv[2]);
        if(!module){wprintf(L"LoadLibrary failed: %lu\n",GetLastError());return 1;}
        auto factoryFn=(HRESULT(__stdcall*)(REFCLSID,REFIID,void**))GetProcAddress(module,"DllGetClassObject");
        CLSID clsid;CLSIDFromString(sourceId,&clsid);
        ComPtr<IClassFactory> factory;ComPtr<IMFActivate> activate;ComPtr<IMFMediaSource> source;ComPtr<IMFSourceReader> reader;ComPtr<IMFSample> sample;
        hr=factoryFn?factoryFn(clsid,IID_PPV_ARGS(&factory)):E_FAIL;
        wprintf(L"Factory: 0x%08X\n",(unsigned)hr);
        if(SUCCEEDED(hr))hr=factory->CreateInstance(nullptr,IID_PPV_ARGS(&activate));
        wprintf(L"Activate instance: 0x%08X\n",(unsigned)hr);
        if(SUCCEEDED(hr))hr=activate->ActivateObject(IID_PPV_ARGS(&source));
        wprintf(L"Source: 0x%08X\n",(unsigned)hr);
        ComPtr<IMFSampleAllocatorControl> allocatorControl;ComPtr<IMFVideoSampleAllocator> allocator;
        if(SUCCEEDED(hr))hr=source.As(&allocatorControl);
        if(SUCCEEDED(hr))hr=MFCreateVideoSampleAllocatorEx(IID_PPV_ARGS(&allocator));
        if(SUCCEEDED(hr))hr=allocatorControl->SetDefaultAllocator(0,allocator.Get());
        if(SUCCEEDED(hr))hr=MFCreateSourceReaderFromMediaSource(source.Get(),nullptr,&reader);
        wprintf(L"Reader: 0x%08X\n",(unsigned)hr);
        if(SUCCEEDED(hr))hr=reader->SetStreamSelection(MF_SOURCE_READER_FIRST_VIDEO_STREAM,TRUE);
        ComPtr<IMFMediaType> type;
        if(SUCCEEDED(hr))hr=reader->GetNativeMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,0,&type);
        if(SUCCEEDED(hr))hr=reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,nullptr,type.Get());
        wprintf(L"Media type: 0x%08X\n",(unsigned)hr);
        DWORD flags=0;LONGLONG time=0;
        if(SUCCEEDED(hr))hr=reader->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM,0,nullptr,&flags,&time,&sample);
        DWORD size=0;if(SUCCEEDED(hr)&&sample)hr=sample->GetTotalLength(&size);else if(SUCCEEDED(hr))hr=E_FAIL;
        if(SUCCEEDED(hr)&&size==0)hr=E_FAIL;
        wprintf(L"Media-source probe: 0x%08X, sample bytes: %lu\n",(unsigned)hr,size);
        if(source)source->Shutdown();return FAILED(hr)?1:0;
    }
    ComPtr<IMFVirtualCamera> camera;
    hr=MFCreateVirtualCamera(MFVirtualCameraType_SoftwareCameraSource,MFVirtualCameraLifetime_System,MFVirtualCameraAccess_CurrentUser,L"FreeShow Virtual Camera",sourceId,nullptr,0,&camera);
    if(SUCCEEDED(hr))hr=(argc>1&&wcscmp(argv[1],L"--remove")==0)?camera->Remove():camera->Start(nullptr);
    wprintf(L"Virtual camera: 0x%08X\n",(unsigned)hr);
    MFShutdown();CoUninitialize();return FAILED(hr)?1:0;
}
